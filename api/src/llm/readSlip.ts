import { callClaudeWithImage, llmAvailable } from './anthropic.js';
import { readImageContent } from '../line/contentStore.js';
import { normalizeSlipDate, normalizeAmount } from '../finance/normalize.js';

export interface SlipFields {
  amount: string;
  bank: string;
  transferAt: string;
  ref: string;
  senderName: string;
}

export interface ChequeFields {
  chequeNo: string;
  chequeBank: string;
  chequeDueDate: string;
  amount: string;
}

const EMPTY: SlipFields = { amount: '', bank: '', transferAt: '', ref: '', senderName: '' };
const EMPTY_CHEQUE: ChequeFields = { chequeNo: '', chequeBank: '', chequeDueDate: '', amount: '' };

const SLIP_SYSTEM = `คุณคือผู้ช่วยอ่าน "สลิปโอนเงิน/หลักฐานการชำระเงิน" จากธนาคารในประเทศไทย (เช่น KBank/K PLUS, SCB, TTB, BBL, กรุงไทย)
ดูรูปสลิปที่แนบมา แล้วดึงข้อมูลออกมาเป็น JSON เท่านั้น
สำคัญ: transferAt ต้องเป็นวันและเวลาที่พิมพ์อยู่ภายในสลิปธนาคารเท่านั้น (วันเวลาโอน/วันที่ทำรายการ/เวลาใต้หัวข้อ "โอนเงินสำเร็จ") ห้ามใช้เวลาที่ข้อความถูกส่งเข้า LINE, เวลาในแชต, เวลา OCR หรือเวลาปัจจุบัน
ให้ถอด transferAt ตามตัวพิมพ์บนสลิปแบบคำต่อคำ (VERBATIM) รวมชื่อเดือนภาษาไทย ปี พ.ศ. เลขไทย และวินาทีถ้ามี ห้ามแปลงชื่อเดือนเป็นตัวเลข ห้ามแปลง พ.ศ. เป็น ค.ศ. ห้ามเปลี่ยนลำดับวัน/เดือน/ปี และห้ามเติมหรือตัดวินาที:
{"senderName":"ชื่อผู้โอน/เจ้าของบัญชีต้นทางที่ปรากฏบนสลิป (เช่น นาย/นาง/น.ส. ... หรือชื่อบัญชี — ผู้ที่ส่งเงินมา ไม่ใช่ผู้รับ)","amount":"จำนวนเงินเป็นตัวเลข เช่น 1500.00 (ไม่มีสัญลักษณ์/คอมมา)","bank":"ธนาคาร/เลขบัญชีปลายทางที่รับเงิน","transferAt":"คัดลอกวันและเวลาที่พิมพ์บนสลิปทุกตัวอักษร ห้ามแปลงรูปแบบ ตัวอย่างถ้าพิมพ์ว่า ๘ ก.ค. ๒๕๖๙ ๑๙:๒๗:๔๑ ให้ตอบข้อความนั้นตรง ๆ","ref":"เลขที่อ้างอิง/รหัสรายการ"}
ถ้าหาค่าใดไม่เจอให้ใส่ "" ห้ามเดา ตอบ JSON อย่างเดียว`;

const CHEQUE_SYSTEM = `คุณคือผู้ช่วยอ่าน "เช็คธนาคาร" จากธนาคารในประเทศไทย
ดูรูปเช็คที่แนบมา แล้วดึงข้อมูลออกมาเป็น JSON เท่านั้น:
{"chequeNo":"เลขที่เช็คที่พิมพ์บนเช็ค ดูบริเวณมุมขวาบน และ/หรือกลุ่มตัวเลขซ้ายสุดของบรรทัด MICR ด้านล่าง โดยทั่วไปมี 6–8 หลัก ให้ตอบเป็นตัวเลข 0-9 เท่านั้น","chequeBank":"ชื่อธนาคารผู้ออกเช็คจากหัวกระดาษหรือตราสัญลักษณ์ เช่น กสิกรไทย กรุงเทพ ไทยพาณิชย์","chequeDueDate":"วันที่ที่เขียนหรือพิมพ์บนเช็ค รูปแบบ วว/ดด/ปปปป ใช้ปี ค.ศ. เท่านั้น (ถ้าเป็น พ.ศ. ให้ลบ 543)","amount":"จำนวนเงินตัวเลขจากช่องจำนวนเงินที่อยู่ในกรอบ ให้ตอบเป็นตัวเลขและจุดทศนิยมเท่านั้น ไม่มีสัญลักษณ์หรือคอมมา"}
ถ้าหาค่าใดไม่เจอให้ใส่ "" ห้ามเดา ตอบ JSON อย่างเดียว`;

// Best-effort OCR of an already-loaded slip image buffer → structured fields. Returns
// all-empty on any failure (no LLM credits, unreadable image, bad JSON) so staff can fill
// manually. Buffer-agnostic — shared by readSlip (LINE-delivered slips) and Juno's manual
// add-payment flow (staff-uploaded slips), which load the bytes from different stores.
export async function readSlipFromBuffer(buf: Buffer, contentType: string): Promise<SlipFields> {
  if (!llmAvailable()) return EMPTY;
  try {
    const raw = await callClaudeWithImage('อ่านสลิปนี้แล้วตอบ JSON ตามรูปแบบที่กำหนด', SLIP_SYSTEM, {
      base64: buf.toString('base64'),
      mediaType: contentType || 'image/jpeg',
    }, undefined, { app: 'minerva', feature: 'slip-ocr' });
    const obj = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim()) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
    return {
      amount: normalizeAmount(s(obj.amount)),
      bank: s(obj.bank),
      transferAt: normalizeSlipDate(s(obj.transferAt)),
      ref: s(obj.ref),
      senderName: s(obj.senderName),
    };
  } catch {
    return EMPTY;
  }
}

export async function readChequeFromBuffer(buf: Buffer, contentType: string): Promise<ChequeFields> {
  if (!llmAvailable()) return EMPTY_CHEQUE;
  try {
    const raw = await callClaudeWithImage('อ่านเช็คนี้แล้วตอบ JSON ตามรูปแบบที่กำหนด', CHEQUE_SYSTEM, {
      base64: buf.toString('base64'),
      mediaType: contentType || 'image/jpeg',
    }, undefined, { app: 'juno', feature: 'cheque-ocr' });
    const obj = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim()) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
    return {
      chequeNo: s(obj.chequeNo).replace(/\D/g, ''),
      chequeBank: s(obj.chequeBank),
      chequeDueDate: normalizeSlipDate(s(obj.chequeDueDate).trim()),
      amount: normalizeAmount(s(obj.amount)),
    };
  } catch {
    return EMPTY_CHEQUE;
  }
}

// Best-effort OCR of a payment slip image → structured fields, loading the bytes from the
// LINE content store by message id. See readSlipFromBuffer for the OCR core.
export async function readSlip(messageId: string, contentType: string): Promise<SlipFields> {
  if (!llmAvailable()) return EMPTY;
  const buf = await readImageContent(messageId);
  if (!buf) return EMPTY;
  return readSlipFromBuffer(buf, contentType);
}

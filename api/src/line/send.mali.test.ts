import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replyMessage: vi.fn(),
  pushMessage: vi.fn(),
  client: null as unknown as { replyMessage: ReturnType<typeof vi.fn>; pushMessage: ReturnType<typeof vi.fn> },
}));
mocks.client = { replyMessage: mocks.replyMessage, pushMessage: mocks.pushMessage };

vi.mock('../env.js', () => ({ env: { LINE_DRY_RUN: '', APPDENT_OWNER_LINE_USER_ID: '' } }));
vi.mock('./client.js', () => ({
  getLineClient: vi.fn(() => null),
  getAppdentLineClient: vi.fn(() => null),
  getMaliLineClient: vi.fn(() => mocks.client),
}));

import { pushMaliLineText, sendMaliLineText } from './send.js';

describe('sendMaliLineText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.replyMessage.mockResolvedValue({ sentMessages: [{ id: 'reply-id' }] });
    mocks.pushMessage.mockResolvedValue({ sentMessages: [{ id: 'push-id' }] });
  });

  it('uses replyMessage first and avoids a push when the reply succeeds', async () => {
    const result = await sendMaliLineText('U-staff', 'reply-token', 'คำตอบค่ะ');

    expect(mocks.replyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token', messages: [{ type: 'text', text: 'คำตอบค่ะ' }],
    });
    expect(mocks.pushMessage).not.toHaveBeenCalled();
    expect(result.channelMsgId).toBe('reply-id');
  });

  it('falls back to a Mali push when LINE rejects an expired reply token', async () => {
    mocks.replyMessage.mockRejectedValue(new Error('expired'));

    const result = await sendMaliLineText('U-staff', 'expired-token', 'คำตอบค่ะ');

    expect(mocks.pushMessage).toHaveBeenCalledWith({
      to: 'U-staff', messages: [{ type: 'text', text: 'คำตอบค่ะ' }],
    });
    expect(result.channelMsgId).toBe('push-id');
  });

  it('puts data-driven department actions on the reply-token message', async () => {
    await sendMaliLineText('U-staff', 'reply-token', 'เลือกแผนกค่ะ', [{
      label: 'ฝ่าย ก',
      data: 'mali:department:q-1:d-1',
      displayText: 'ส่งต่อให้ ฝ่าย ก',
    }]);

    expect(mocks.replyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token',
      messages: [{
        type: 'text',
        text: 'เลือกแผนกค่ะ',
        quickReply: {
          items: [{
            type: 'action',
            action: {
              type: 'postback',
              label: 'ฝ่าย ก',
              data: 'mali:department:q-1:d-1',
              displayText: 'ส่งต่อให้ ฝ่าย ก',
            },
          }],
        },
      }],
    });
  });

  it('uses push directly for escalation notifications', async () => {
    await pushMaliLineText('U-answerer', 'มีคำถามรอคำตอบ');

    expect(mocks.replyMessage).not.toHaveBeenCalled();
    expect(mocks.pushMessage).toHaveBeenCalledWith({
      to: 'U-answerer',
      messages: [{ type: 'text', text: 'มีคำถามรอคำตอบ' }],
    });
  });
});

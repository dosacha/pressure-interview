import { readInterviewConfig } from './interview.config';

describe('readInterviewConfig', () => {
  it('기본값은 질문 6개, 24시간', () => {
    expect(readInterviewConfig({})).toEqual({ questionLimit: 6, reissueAfterHours: 24 });
  });
  it('환경 변수로 바꾸고, 빈 문자열은 설정 안 함으로 본다', () => {
    expect(
      readInterviewConfig({ INTERVIEW_QUESTION_LIMIT: '10', MEMORY_REISSUE_AFTER_HOURS: '48' }),
    ).toEqual({ questionLimit: 10, reissueAfterHours: 48 });
    expect(readInterviewConfig({ INTERVIEW_QUESTION_LIMIT: '' }).questionLimit).toBe(6);
  });
  it('질문 수가 2~30 밖이면 변수 이름으로 던진다', () => {
    expect(() => readInterviewConfig({ INTERVIEW_QUESTION_LIMIT: '1' })).toThrow(
      'INTERVIEW_QUESTION_LIMIT',
    );
    expect(() => readInterviewConfig({ INTERVIEW_QUESTION_LIMIT: '31' })).toThrow(
      'INTERVIEW_QUESTION_LIMIT',
    );
  });
  it('재출제 시간이 양의 정수가 아니면 변수 이름으로 던진다', () => {
    expect(() => readInterviewConfig({ MEMORY_REISSUE_AFTER_HOURS: '0' })).toThrow(
      'MEMORY_REISSUE_AFTER_HOURS',
    );
  });
});

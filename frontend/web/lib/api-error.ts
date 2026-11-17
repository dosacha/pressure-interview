export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

const FALLBACK = '문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.';

const BY_CODE: Record<string, { text: string; reload: boolean }> = {
  LLM_FAILED: { text: '면접관의 응답을 받지 못했습니다. 다시 시도해 주세요.', reload: false },
  TURN_NOT_OPEN: { text: '이미 답한 질문입니다. 화면을 새로 고칩니다.', reload: true },
  NOTHING_TO_RETRY: { text: '이미 진행됐습니다. 화면을 새로 고칩니다.', reload: true },
  INTERVIEW_FINISHED: { text: '끝난 면접입니다.', reload: true },
  INVALID_INPUT: { text: '입력을 확인해 주세요.', reload: false },
  NOT_FOUND: { text: '면접을 찾을 수 없습니다.', reload: false },
  INTERVIEW_NOT_FINISHED: {
    text: '아직 끝나지 않은 면접입니다. 면접을 끝낸 뒤에 복기를 볼 수 있습니다.',
    reload: false,
  },
  NOT_REVIEWABLE: {
    text: '이 질문은 복기에서 고칠 수 없습니다. 화면을 새로 고칩니다.',
    reload: true,
  },
};

export function describeApiError(e: unknown): { text: string; reload: boolean } {
  if (e instanceof ApiError && Object.hasOwn(BY_CODE, e.code)) return BY_CODE[e.code];
  return { text: FALLBACK, reload: false };
}

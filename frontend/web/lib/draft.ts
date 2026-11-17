type OpenTurn = { turnId: string | null; clarifications: number };

// 새 질문이 열렸거나 되묻기 응답이 붙었을 때만 true. 실패해서 같은 턴이 그대로면 쓰던 글을 지키려고 false.
export function shouldClearDraft(prev: OpenTurn, next: OpenTurn): boolean {
  return prev.turnId !== next.turnId || prev.clarifications !== next.clarifications;
}

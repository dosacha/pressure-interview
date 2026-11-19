// 서버판 src/interview/naming.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
                                                         

// shortcut: 대소문자·공백만 맞춘다. 한글 표기("카프카")·별칭("Postgres")은 못 잡음, R1에서 놓친 사례가 나오면 별칭 표 추가
export const normalize = (name        )         => name.trim().toLowerCase();

export function checkNaming(input   
                       
                          
                   
 )               {
  const mentioned = new Set(input.userMentioned.map(normalize));
  const avoid = new Set((input.avoid ?? []).map(normalize));
  // 모른다고 한 기술은 역할과 상관없이 위반이다. 전제로 다시 꺼내도 지원자는 답할 수 없다.
  const violations = input.techs
    .filter(
      (t) =>
        avoid.has(normalize(t.name)) || (t.role !== 'premise' && !mentioned.has(normalize(t.name))),
    )
    .map((t) => t.name.trim());
  const avoided = violations.filter((name) => avoid.has(normalize(name)));
  return { ok: violations.length === 0, violations, avoided };
}

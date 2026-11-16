import type { NamingResult, TechMention } from './types';

// shortcut: 대소문자·공백만 맞춘다. 한글 표기("카프카")·별칭("Postgres")은 못 잡음, R1에서 놓친 사례가 나오면 별칭 표 추가
const normalize = (name: string): string => name.trim().toLowerCase();

export function checkNaming(input: {
  techs: TechMention[];
  userMentioned: string[];
}): NamingResult {
  const mentioned = new Set(input.userMentioned.map(normalize));
  const violations = input.techs
    .filter((t) => t.role !== 'premise' && !mentioned.has(normalize(t.name)))
    .map((t) => t.name.trim());
  return { ok: violations.length === 0, violations };
}

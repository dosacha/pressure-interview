// 개발 DB를 테스트가 건드리지 못하게 한다. 실행기(npm run test:e2e)만 이 값을 맞춰 준다.
if (process.env.NODE_ENV !== 'test') {
  throw new Error('e2e 테스트는 NODE_ENV=test여야 한다');
}

if (process.env.DB_DATABASE !== 'interview_e2e') {
  throw new Error('e2e 테스트는 DB_DATABASE=interview_e2e여야 한다');
}

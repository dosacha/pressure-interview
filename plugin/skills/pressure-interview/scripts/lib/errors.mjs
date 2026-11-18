// 엔진의 예상된 실패. detail은 로그에만 쓰고 출력에 내지 않는다.
export class EngineError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }
}

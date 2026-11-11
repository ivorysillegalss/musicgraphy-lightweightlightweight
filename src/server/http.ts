// 统一错误 envelope（ADR-007 条 6，复审 V1）：{error:{code,message,details?}}，禁 200+error
export function errorBody(code: string, message: string, details?: unknown): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

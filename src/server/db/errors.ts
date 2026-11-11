// DAO 类型化错误 → HTTP 语义（app.ts onError 映射 409/404/400，复审 V1）
export class DuplicateRecordError extends Error {
  constructor(public readonly recordId: string) {
    super('duplicate_record');
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('record_not_found');
  }
}

export class CursorInvalidError extends Error {
  constructor() {
    super('cursor_invalid');
  }
}

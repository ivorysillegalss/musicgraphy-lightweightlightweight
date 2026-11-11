// 无日志库（ADR-004 内置替代清单）：stdout 单行，由守护做轮转（复审 V8）
type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function emit(level: Level, module: string, message: string, meta?: Record<string, unknown>): void {
  const extra = meta === undefined ? '' : ' ' + JSON.stringify(meta);
  console.log(`${new Date().toISOString()} ${level} [${module}] ${message}${extra}`);
}

export const logger = {
  debug: (module: string, message: string, meta?: Record<string, unknown>): void => emit('DEBUG', module, message, meta),
  info: (module: string, message: string, meta?: Record<string, unknown>): void => emit('INFO', module, message, meta),
  warn: (module: string, message: string, meta?: Record<string, unknown>): void => emit('WARN', module, message, meta),
  error: (module: string, message: string, meta?: Record<string, unknown>): void => emit('ERROR', module, message, meta)
};

import cron from 'node-cron';
import cronstrue from 'cronstrue/i18n.js';

export function validateCron(expr) {
  return typeof expr === 'string' && expr.trim().split(/\s+/).length === 5 && cron.validate(expr);
}

export function describeNext(expr) {
  if (!validateCron(expr)) {
    return '無効な cron 式';
  }

  try {
    return cronstrue.toString(expr, { locale: 'ja' });
  } catch {
    return '';
  }
}

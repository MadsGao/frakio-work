const severityValues = new Set(['core', 'standard', 'optional']);

function issueText(step) {
  return `${step.label}: ${step.detail || (step.status === 'warning' ? '未启动' : '启动失败')}`;
}

export function runtimeStep(id, label, status, detail = '', severity = 'standard') {
  return {
    id,
    label,
    status,
    detail,
    severity: severityValues.has(severity) ? severity : 'standard',
  };
}

export function summarizeRuntimeAutoStart(steps = []) {
  const failed = steps.filter((step) => step.status === 'failed');
  const coreFailures = failed.filter((step) => step.severity === 'core');
  const standardFailures = failed.filter((step) => step.severity !== 'core' && step.severity !== 'optional');
  const optionalWarnings = steps.filter((step) => step.severity === 'optional' && ['failed', 'warning'].includes(step.status));
  return {
    status: coreFailures.length ? 'failed' : standardFailures.length ? 'partial' : 'ready',
    error: coreFailures.map(issueText).join('\n'),
    warnings: [...standardFailures, ...optionalWarnings].map(issueText),
  };
}

import { CheckCircle2, Circle, Clock3 } from 'lucide-react';
import frakioBrandLogoUrl from '../../assets/frakio-brand-logo.png';

type LaunchPhase = 'booting' | 'connecting' | 'welcome';
type LaunchStep = {
  id: string;
  label: string;
  status: 'running' | 'ready' | 'failed' | 'skipped';
  detail?: string;
};
type AutoStart = { steps?: LaunchStep[] } | null;

const fallbackSteps: LaunchStep[] = [
  { id: 'profiles', label: '读取本地 Hermes Profiles', status: 'running' },
  { id: 'bridge', label: '启动 Frakio Work Bridge', status: 'running' },
  { id: 'api', label: '启动 Frakio Work Runtime API', status: 'running' },
  { id: 'gateways', label: '启动 Profile Gateway', status: 'running' },
];

export function summarizeLaunchDetail(value = '') {
  const lines = String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const preferred = [...lines].reverse().find((line) => /(?:error|failed|not installed|未启动|失败)/i.test(line)) || lines.at(-1) || '';
  return preferred.replace(/^stderr:\s*/i, '').slice(0, 180);
}

export function LaunchLoadingScreen({ phase, agentName, userAvatarUrl, autoStart }: {
  phase: LaunchPhase;
  agentName: string;
  userAvatarUrl: string;
  autoStart: AutoStart;
}) {
  const welcome = phase === 'welcome';
  const steps = autoStart?.steps?.length ? autoStart.steps : fallbackSteps;
  return (
    <div className={`launch-screen ${welcome ? 'welcome' : 'working'}`} role="status" aria-live="polite" data-launch-phase={phase}>
      <div className={`launch-shell ${userAvatarUrl ? 'has-user-avatar' : 'no-user-avatar'}`}>
        <span className="launch-image-avatar brand-logo"><img src={frakioBrandLogoUrl} alt="" /></span>
        {welcome ? (
          <div className="launch-panel launch-welcome-panel" data-launch-panel="welcome">
            <div className="launch-welcome">
              <span>Hi，</span>
              {userAvatarUrl && <span className="launch-user-avatar"><img src={userAvatarUrl} alt="" /></span>}
              <span>欢迎回来</span>
            </div>
          </div>
        ) : (
          <div className="launch-panel launch-working-panel" data-launch-panel="working">
            <div className="launch-head">
              <strong>正在连接本地 Hermes Agent</strong>
              <span>{agentName ? `${agentName} 正在准备工作环境` : '正在准备工作环境'}</span>
            </div>
            <div className="launch-task-list">
              {steps.map((step) => {
                const done = step.status === 'ready' || step.status === 'skipped';
                const active = step.status === 'running';
                const failed = step.status === 'failed';
                const Icon = done ? CheckCircle2 : active ? Clock3 : Circle;
                const detail = summarizeLaunchDetail(step.detail);
                return (
                  <div className={`task-row ${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''}`} key={step.id}>
                    <Icon size={15} />
                    <span><strong>{step.label}</strong>{detail && <small>{detail}</small>}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

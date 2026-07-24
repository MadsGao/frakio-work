const QUOTED_MESSAGE_BLOCK_RE = /<quoted_message(?:\s[^>]*)?>[\s\S]*?<\/quoted_message>/gi;
const ASCII_WORD_RE = /[A-Za-z0-9_]/;

function maskQuotedMessageBlocks(content) {
  return String(content || '').replace(QUOTED_MESSAGE_BLOCK_RE, (block) => block.replace(/[^\n]/g, ' '));
}

export function normalizeAgentMentionMaxDepth(value, fallback = 2) {
  if (value === 'unlimited') return 'unlimited';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

export function mentionDepthAllows(depth, maxDepth) {
  const normalizedDepth = Math.max(0, Math.floor(Number(depth) || 0));
  return maxDepth === 'unlimited' || normalizedDepth <= normalizeAgentMentionMaxDepth(maxDepth, 2);
}

export function registerMentionEdge(routedEdges, senderAgentId, targetAgentId) {
  const edge = `${String(senderAgentId || '')}->${String(targetAgentId || '')}`;
  if (!senderAgentId || !targetAgentId || routedEdges.has(edge)) return false;
  routedEdges.add(edge);
  return true;
}

function aliasesForAgent(agent) {
  return Array.from(new Set([agent?.name, agent?.id, agent?.profileName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function validMentionStart(content, atIndex) {
  const before = content[atIndex - 1];
  return before === undefined || !ASCII_WORD_RE.test(before);
}

function validMentionEnd(alias, after) {
  if (after === undefined) return true;
  const aliasEnd = alias[alias.length - 1];
  return !(ASCII_WORD_RE.test(aliasEnd || '') && ASCII_WORD_RE.test(after));
}

function mentionCandidates(agents) {
  const candidates = [];
  for (const agent of agents || []) {
    for (const alias of aliasesForAgent(agent)) candidates.push({ agent, alias, lower: alias.toLowerCase() });
  }
  return candidates.sort((a, b) => b.alias.length - a.alias.length);
}

export function resolveMentionedAgents(content, agents, options = {}) {
  const raw = maskQuotedMessageBlocks(content);
  const lower = raw.toLowerCase();
  const senderAgentId = String(options.senderAgentId || '');
  const candidates = mentionCandidates(agents);
  const fallbackAgent = (agents || []).find((agent) => agent.id === options.fallbackAgentId);
  const matches = [];
  const seen = new Set();

  for (let atIndex = lower.indexOf('@'); atIndex >= 0; atIndex = lower.indexOf('@', atIndex + 1)) {
    if (!validMentionStart(raw, atIndex)) continue;
    const tail = lower.slice(atIndex + 1);
    if (tail.startsWith('all') && validMentionEnd('all', raw[atIndex + 4])) {
      const broadcast = agents || [];
      const targets = broadcast.length ? broadcast : [fallbackAgent || agents?.[0]].filter(Boolean);
      for (const agent of targets) {
        if (!agent || agent.id === senderAgentId || seen.has(agent.id)) continue;
        seen.add(agent.id);
        matches.push(agent);
      }
      continue;
    }

    const candidate = candidates.find(({ alias, lower: aliasLower }) => (
      tail.startsWith(aliasLower) && validMentionEnd(alias, raw[atIndex + alias.length + 1])
    ));
    if (!candidate || candidate.agent.id === senderAgentId || seen.has(candidate.agent.id)) continue;
    seen.add(candidate.agent.id);
    matches.push(candidate.agent);
  }
  return matches;
}

export function isMentionNamePresent(content, mentionName) {
  const alias = String(mentionName || '').trim();
  if (!alias) return false;
  return resolveMentionedAgents(content, [{ id: '__mention__', name: alias }]).length > 0;
}

export function stripMentionRoutingTokens(content, agent) {
  const aliases = aliasesForAgent(agent).sort((a, b) => b.length - a.length);
  let result = String(content || '');
  for (const alias of ['all', ...aliases]) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`@${escaped}`, 'gi'), '');
  }
  return result
    .replace(/^[\s,\uff0c:\uff1a;\uff1b.!?\u3002\uff01\uff1f]+/, '')
    .replace(/[\s,\uff0c:\uff1a;\uff1b]+$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

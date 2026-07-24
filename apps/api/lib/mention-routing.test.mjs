import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionDepthAllows, normalizeAgentMentionMaxDepth, registerMentionEdge, resolveMentionedAgents } from './mention-routing.mjs';

const agents = [
  { id: 'director', name: '设计总监', profileName: 'design-director' },
  { id: 'max', name: 'Max', profileName: 'commander' },
  { id: 'maxwell', name: 'Maxwell' },
];

test('mentions work directly after CJK and before continuing CJK text', () => {
  assert.deepEqual(resolveMentionedAgents('你@设计总监出来打个招呼', agents).map((agent) => agent.id), ['director']);
});

test('ASCII email-style text and prefix collisions do not cause false matches', () => {
  assert.deepEqual(resolveMentionedAgents('mail user@max.example', agents), []);
  assert.deepEqual(resolveMentionedAgents('@Maxwell hello', agents).map((agent) => agent.id), ['maxwell']);
});

test('multiple mentions route once and exclude the sender', () => {
  assert.deepEqual(resolveMentionedAgents('@Max @设计总监 @Max', agents, { senderAgentId: 'director' }).map((agent) => agent.id), ['max']);
});

test('@all wakes every available team agent except the sender', () => {
  assert.deepEqual(resolveMentionedAgents('@all hello', agents, { selectedAgentIds: ['max'], senderAgentId: 'max' }).map((agent) => agent.id), ['director', 'maxwell']);
});

test('mention depth setting accepts zero, positive integers, and unlimited', () => {
  assert.equal(normalizeAgentMentionMaxDepth(undefined), 2);
  assert.equal(normalizeAgentMentionMaxDepth(-1), 2);
  assert.equal(normalizeAgentMentionMaxDepth(0), 0);
  assert.equal(normalizeAgentMentionMaxDepth(3.9), 3);
  assert.equal(normalizeAgentMentionMaxDepth('unlimited'), 'unlimited');
  assert.equal(mentionDepthAllows(1, 0), false);
  assert.equal(mentionDepthAllows(2, 2), true);
  assert.equal(mentionDepthAllows(200, 'unlimited'), true);
});

test('the same directed mention edge is routed only once per turn', () => {
  const edges = new Set();
  assert.equal(registerMentionEdge(edges, 'a', 'b'), true);
  assert.equal(registerMentionEdge(edges, 'b', 'a'), true);
  assert.equal(registerMentionEdge(edges, 'a', 'b'), false);
});

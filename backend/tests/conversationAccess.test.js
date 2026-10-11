const test = require('node:test');
const assert = require('node:assert/strict');
const Conversation = require('../models/Conversation');
const conversationRoutes = require('../routes/conversationRoutes');
const groupRoutes = require('../routes/groupRoutes');

const conversationId = '507f1f77bcf86cd799439011';
const ownerId = '507f191e810c19729de860ea';
const outsiderId = '507f191e810c19729de860eb';

async function withConversationMembers(members, operation) {
  const originalFindById = Conversation.findById;
  const fakeConversation = {
    type: 'group',
    members: members.map((id) => ({
      _id: { toString: () => id },
      toString: () => id,
    })),
  };
  Conversation.findById = () => ({
    ...fakeConversation,
    populate: async () => fakeConversation,
  });

  try {
    await operation();
  } finally {
    Conversation.findById = originalFindById;
  }
}

test('private conversation access rejects users who are not members', async () => {
  await withConversationMembers([ownerId], async () => {
    await assert.rejects(
      conversationRoutes.ensureConversationAccess(outsiderId, conversationId),
      (error) => error.statusCode === 403,
    );
  });
});

test('private group access rejects users who are not members', async () => {
  await withConversationMembers([ownerId], async () => {
    await assert.rejects(
      groupRoutes.ensureGroupAccess(outsiderId, conversationId),
      (error) => error.statusCode === 403,
    );
  });
});

test('conversation access allows an existing member', async () => {
  await withConversationMembers([ownerId], async () => {
    const conversation = await conversationRoutes.ensureConversationAccess(ownerId, conversationId);
    assert.equal(conversation.members.length, 1);
  });
});

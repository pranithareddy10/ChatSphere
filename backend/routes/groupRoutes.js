const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function removeUserSocketsFromGroup(groupId, userId) {
  const io = global.__io;
  if (!io) return;
  const userRoom = `user:${userId.toString()}`;
  const groupRoom = groupId.toString();
  io.in(userRoom).socketsLeave(groupRoom);
  io.to(userRoom).emit('conversation-removed', { conversationId: groupRoom });
}

function emitGroupUpdated(group) {
  const io = global.__io;
  if (!io) return;
  const payload = { conversation: group };
  io.to(group._id.toString()).emit('group-updated', payload);
  group.members.forEach((member) => {
    const memberId = member._id || member;
    io.to(`user:${memberId.toString()}`).emit('group-updated', payload);
  });
}

async function ensureGroupAccess(userId, groupId) {
  if (!mongoose.isValidObjectId(groupId)) {
    const error = new Error('Group not found.');
    error.statusCode = 404;
    throw error;
  }
  const group = await Conversation.findById(groupId);

  if (!group || group.type !== 'group') {
    const error = new Error('Group not found.');
    error.statusCode = 404;
    throw error;
  }

  if (!group.members.some((member) => member.toString() === userId.toString())) {
    const error = new Error('You are not a member of this group.');
    error.statusCode = 403;
    throw error;
  }

  return group;
}

router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { name, members = [], image = '' } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Group name is required.' });
    }

    if (!Array.isArray(members)) return res.status(400).json({ message: 'Members must be an array of user identifiers.' });
    if (typeof image !== 'string') return res.status(400).json({ message: 'Group image must be a URL string.' });
    const uniqueMembers = Array.from(new Set([req.user._id.toString(), ...members.map(String)]));
    if (uniqueMembers.some((memberId) => !mongoose.isValidObjectId(memberId))) {
      return res.status(400).json({ message: 'All group members must have valid user identifiers.' });
    }
    const existingUsers = await User.countDocuments({ _id: { $in: uniqueMembers } });
    if (existingUsers !== uniqueMembers.length) return res.status(400).json({ message: 'One or more group members do not exist.' });

    const group = await Conversation.create({
      type: 'group',
      name: name.trim(),
      image,
      members: uniqueMembers,
      metadata: {
        admins: [req.user._id],
      },
    });

    await group.populate('members', 'name email avatar status');
    const io = global.__io;
    if (io) {
      group.members.forEach((member) => io.to(`user:${member._id.toString()}`).emit('conversation-added', { conversation: group }));
    }
    return res.status(201).json({ group });
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId', authMiddleware, async (req, res, next) => {
  try {
    const group = await ensureGroupAccess(req.user._id, req.params.groupId);
    await group.populate('members', 'name email avatar status');
    return res.json({ group });
  } catch (error) {
    next(error);
  }
});

router.patch('/:groupId/details', authMiddleware, async (req, res, next) => {
  try {
    const group = await ensureGroupAccess(req.user._id, req.params.groupId);
    const admins = group.metadata?.admins || [];
    const isAdmin = admins.some((adminId) => adminId.toString() === req.user._id.toString());

    if (!isAdmin) {
      return res.status(403).json({ message: 'Only group admins can update group details.' });
    }

    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ message: 'Group name cannot be empty.' });
      }
      group.name = req.body.name.trim();
    }
    if (req.body.image !== undefined) {
      if (typeof req.body.image !== 'string') return res.status(400).json({ message: 'Group image must be a URL string.' });
      group.image = req.body.image.trim();
    }
    await group.save();

    emitGroupUpdated(group);
    return res.json({ group });
  } catch (error) {
    next(error);
  }
});

router.patch('/:groupId/members', authMiddleware, async (req, res, next) => {
  try {
    const group = await ensureGroupAccess(req.user._id, req.params.groupId);
    const admins = group.metadata?.admins || [];
    const isAdmin = admins.some((adminId) => adminId.toString() === req.user._id.toString());

    if (!isAdmin) {
      return res.status(403).json({ message: 'Only group admins can manage members.' });
    }

    const { action = 'add', memberId } = req.body || {};
    if (!memberId || !mongoose.isValidObjectId(memberId)) {
      return res.status(400).json({ message: 'A member identifier is required.' });
    }

    if (action === 'add') {
      const member = await User.findById(memberId);
      if (!member) return res.status(404).json({ message: 'Member not found.' });
      if (!group.members.some((member) => member.toString() === memberId.toString())) {
        group.members.push(memberId);
      }
    } else if (action === 'remove') {
      if (!group.members.some((member) => member.toString() === memberId.toString())) {
        return res.status(404).json({ message: 'Member is not in this group.' });
      }
      const currentAdmins = group.metadata?.admins || [];
      const targetIsAdmin = currentAdmins.some((adminId) => adminId.toString() === memberId.toString());
      const adminCount = currentAdmins.length;
      if (targetIsAdmin && adminCount === 1) {
        return res.status(400).json({ message: 'A group must keep at least one administrator.' });
      }
      group.members = group.members.filter((member) => member.toString() !== memberId.toString());
      group.metadata.admins = currentAdmins.filter((adminId) => adminId.toString() !== memberId.toString());
    } else {
      return res.status(400).json({ message: 'Unsupported member action.' });
    }

    await group.save();
    await group.populate('members', 'name email avatar status');
    if (action === 'remove') removeUserSocketsFromGroup(group._id, memberId);
    emitGroupUpdated(group);
    if (action === 'add' && global.__io) global.__io.to(`user:${memberId}`).emit('conversation-added', { conversation: group });
    return res.json({ group });
  } catch (error) {
    next(error);
  }
});

router.patch('/:groupId/admins', authMiddleware, async (req, res, next) => {
  try {
    const group = await ensureGroupAccess(req.user._id, req.params.groupId);
    const admins = group.metadata?.admins || [];
    if (!admins.some((adminId) => adminId.toString() === req.user._id.toString())) {
      return res.status(403).json({ message: 'Only group admins can manage administrators.' });
    }

    const { memberId, action } = req.body || {};
    if (!memberId || !mongoose.isValidObjectId(memberId)) {
      return res.status(400).json({ message: 'A valid member identifier is required.' });
    }
    if (!group.members.some((member) => member.toString() === memberId.toString())) {
      return res.status(404).json({ message: 'Member is not in this group.' });
    }

    const isAdmin = admins.some((adminId) => adminId.toString() === memberId.toString());
    if (action === 'promote' && !isAdmin) {
      group.metadata.admins.push(memberId);
    } else if (action === 'demote' && isAdmin) {
      if (admins.length <= 1) return res.status(400).json({ message: 'A group must keep at least one administrator.' });
      group.metadata.admins = admins.filter((adminId) => adminId.toString() !== memberId.toString());
    } else if (!['promote', 'demote'].includes(action)) {
      return res.status(400).json({ message: 'Administrator action must be promote or demote.' });
    }

    await group.save();
    await group.populate('members', 'name email avatar status');
    emitGroupUpdated(group);
    return res.json({ group });
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/leave', authMiddleware, async (req, res, next) => {
  try {
    const group = await ensureGroupAccess(req.user._id, req.params.groupId);

    if (group.members.length <= 1) {
      const memberIds = group.members.map((member) => member.toString());
      await group.deleteOne();
      memberIds.forEach((memberId) => removeUserSocketsFromGroup(group._id, memberId));
      return res.json({ message: 'Group deleted because it had no remaining members.' });
    }

    const currentAdmins = group.metadata?.admins || [];
    const isLastAdmin = currentAdmins.length === 1 &&
      currentAdmins[0].toString() === req.user._id.toString();
    const nextAdmin = group.members.find((member) => member.toString() !== req.user._id.toString());
    group.members = group.members.filter((member) => member.toString() !== req.user._id.toString());
    group.metadata.admins = currentAdmins.filter((adminId) => adminId.toString() !== req.user._id.toString());
    if (isLastAdmin && nextAdmin) group.metadata.admins.push(nextAdmin);
    await group.save();
    await group.populate('members', 'name email avatar status');
    removeUserSocketsFromGroup(group._id, req.user._id);
    emitGroupUpdated(group);

    return res.json({ message: 'You left the group successfully.', group });
  } catch (error) {
    next(error);
  }
});

router.ensureGroupAccess = ensureGroupAccess;

module.exports = router;

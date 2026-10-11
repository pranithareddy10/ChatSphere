const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = localStorage.getItem('chatsphere-token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(
      `Cannot reach the ChatSphere backend at ${API_BASE_URL}. Start it with "npm.cmd start" from the backend folder.`,
    );
  }

  const responseText = await response.text();
  let payload = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      if (response.ok) throw new Error('The backend returned an invalid response.');
    }
  }

  if (!response.ok) {
    if (response.status >= 500 && !payload.message) {
      throw new Error(`The backend returned HTTP ${response.status}. Check its terminal for startup or database errors.`);
    }
    throw new Error(payload.message || 'Request failed.');
  }

  return payload;
}

export async function registerUser(data) {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function loginUser(data) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchProfile() {
  return request('/auth/me');
}

export async function getUsers(search = '') {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  return request(`/auth/users${query.size ? `?${query.toString()}` : ''}`);
}

export async function updateProfile(data) {
  return request('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function logoutUser() {
  return request('/auth/logout', { method: 'POST' });
}

export async function getConversations() {
  return request('/conversations');
}

export async function createConversation(data) {
  return request('/conversations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMessages(conversationId, options = {}) {
  const query = new URLSearchParams({ limit: String(options.limit || 50) });
  if (options.before) query.set('before', options.before);
  if (options.search) query.set('search', options.search);
  return request(`/conversations/${conversationId}/messages?${query.toString()}`);
}

export async function sendMessage(conversationId, data) {
  return request(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function editMessage(conversationId, messageId, text) {
  return request(`/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
}

export async function deleteMessage(conversationId, messageId) {
  return request(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
}

export async function toggleMessageReaction(conversationId, messageId, reaction) {
  return request(`/conversations/${conversationId}/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ reaction }),
  });
}

export async function markConversationRead(conversationId, messageIds = []) {
  return request(`/conversations/${conversationId}/read`, {
    method: 'POST',
    body: JSON.stringify({ messageIds }),
  });
}

export async function uploadMessageAttachment(conversationId, file, messageType, replyTo) {
  const formData = new FormData();
  formData.set('file', file);
  formData.set('conversationId', conversationId);
  formData.set('messageType', messageType);
  if (replyTo) formData.set('replyTo', replyTo);
  return request('/uploads', { method: 'POST', body: formData });
}

export async function createGroup(data) {
  return request('/groups/create', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateGroupMembers(groupId, action, memberId) {
  return request(`/groups/${groupId}/members`, {
    method: 'PATCH',
    body: JSON.stringify({ action, memberId }),
  });
}

export async function updateGroupAdmin(groupId, action, memberId) {
  return request(`/groups/${groupId}/admins`, {
    method: 'PATCH',
    body: JSON.stringify({ action, memberId }),
  });
}

export async function leaveGroup(groupId) {
  return request(`/groups/${groupId}/leave`, { method: 'POST' });
}

export async function getTransactions() {
  return request('/payments');
}

export async function verifyDemoPayment(transactionId) {
  return request(`/payments/${transactionId}/verify`, { method: 'POST' });
}

export async function createDemoPayment(data) {
  return request('/payments/demo', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export const apiBaseUrl = API_BASE_URL;
export const socketBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Archive,
  Bell,
  Check,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  Lock,
  LogOut,
  MessageSquareText,
  Mic,
  Moon,
  MoreHorizontal,
  Paperclip,
  Phone,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Sun,
  Trash,
  User,
  Users,
  Video,
  Wallet,
  X,
} from 'lucide-react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { currentUser, demoRecipients, initialChats, initialContacts, initialTransactions } from './data/mockData';
import {
  apiBaseUrl,
  createDemoPayment,
  createConversation,
  createGroup,
  deleteMessage,
  editMessage,
  fetchProfile,
  getConversations,
  getTransactions,
  getUsers,
  getMessages,
  leaveGroup,
  loginUser,
  logoutUser,
  markConversationRead,
  registerUser,
  sendMessage,
  socketBaseUrl,
  toggleMessageReaction,
  updateGroupAdmin,
  updateGroupMembers,
  updateProfile,
  uploadMessageAttachment,
  verifyDemoPayment,
} from './services/api';

const getStoredUser = () => {
  try {
    const savedUser = localStorage.getItem('chatsphere-user');
    return savedUser ? JSON.parse(savedUser) : currentUser;
  } catch (error) {
    return currentUser;
  }
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

function mapMessage(message, userId) {
  const sender = message.sender && typeof message.sender === 'object' ? message.sender : null;
  const reply = message.replyTo && typeof message.replyTo === 'object' ? message.replyTo : null;
  return {
    id: message._id || message.id,
    clientMessageId: message.clientMessageId || null,
    createdAt: message.createdAt || null,
    sender: sender && String(sender._id) === String(userId) ? 'me' : sender?.name || message.sender || 'Unknown',
    senderId: sender?._id || message.senderId,
    text: message.text || '',
    time: message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : message.time || 'Now',
    status: message.deliveryStatus === 'read' ? 'Read' : message.deliveryStatus === 'delivered' ? 'Delivered' : message.status || 'Sent',
    reactions: message.reactions?.toObject ? message.reactions.toObject() : message.reactions || {},
    reactionUsers: message.reactionUsers || [],
    readBy: message.readBy || [],
    messageType: message.messageType || 'text',
    attachment: message.attachment || null,
    replyTo: reply ? {
      id: reply._id,
      name: reply.sender?.name || 'Message',
      text: reply.text || reply.attachment?.fileName || '',
    } : message.replyTo || null,
  };
}

function mapConversation(conversation, userId) {
  const members = conversation.members || [];
  const otherMember = members.find((member) => String(member._id || member) !== String(userId));
  const displayName = conversation.type === 'individual'
    ? otherMember?.name || conversation.name || 'Conversation'
    : conversation.name || 'Group conversation';
  return {
    id: conversation._id || conversation.id,
    type: conversation.type === 'individual' ? 'direct' : conversation.type,
    name: displayName,
    avatar: conversation.type === 'group'
      ? displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'G'
      : otherMember?.avatar || displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'C',
    accent: conversation.type === 'group' ? 'violet' : 'sky',
    online: false,
    status: conversation.type === 'group' ? `${members.length} members` : otherMember?.status || 'Conversation',
    members,
    admins: conversation.metadata?.admins || [],
    lastMessage: conversation.lastMessage || 'No messages yet',
    lastMessageTime: conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    unread: conversation.unreadCount || 0,
    pinned: false,
    muted: false,
    archived: false,
    messages: [],
  };
}

function mapTransaction(transaction) {
  return {
    id: transaction._id || transaction.id,
    recipient: transaction.recipient?.name || transaction.recipient || 'Recipient',
    amount: transaction.amount,
    note: transaction.paymentNote || transaction.note || '',
    date: new Date(transaction.createdAt || transaction.date || Date.now()).toISOString().slice(0, 10),
    status: (transaction.status || 'pending').replace(/^./, (letter) => letter.toUpperCase()),
    reference: transaction.providerReference || transaction.reference || '',
    paymentMethod: 'Demo wallet transfer',
  };
}

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: MessageSquareText },
  { label: 'Contacts', to: '/contacts', icon: Users },
  { label: 'Archived', to: '/archived', icon: Archive },
  { label: 'Payments', to: '/payments', icon: Wallet },
  { label: 'Settings', to: '/settings', icon: Settings },
];

function App() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('chatsphere-theme');
    return savedTheme || 'dark';
  });
  const [sessionUser, setSessionUser] = useState(getStoredUser);
  const [liveMode, setLiveMode] = useState(() => Boolean(localStorage.getItem('chatsphere-token')));
  const [chats, setChats] = useState(() => localStorage.getItem('chatsphere-token') ? [] : initialChats);
  const [contacts, setContacts] = useState(initialContacts);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [notificationStatus, setNotificationStatus] = useState(() => {
    if (typeof Notification === 'undefined') return 'Unavailable';
    return Notification.permission === 'granted' ? 'Enabled' : Notification.permission === 'denied' ? 'Blocked' : 'Not enabled';
  });
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(() => localStorage.getItem('chatsphere-read-receipts') !== 'false');
  const [conversationsLoading, setConversationsLoading] = useState(Boolean(localStorage.getItem('chatsphere-token')));
  const [conversationError, setConversationError] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chatsphere-theme', theme);
  }, [theme]);

  const refreshConversations = async () => {
    const token = localStorage.getItem('chatsphere-token');
    if (!token) {
      setLiveMode(false);
      setChats(initialChats);
      setConversationsLoading(false);
      return [];
    }

    setLiveMode(true);
    setConversationsLoading(true);
    setConversationError('');
    try {
      const response = await getConversations();
      const mappedChats = (response.conversations || []).map((conversation) =>
        mapConversation(conversation, getStoredUser()._id || getStoredUser().id),
      );
      setChats(mappedChats);
      return mappedChats;
    } catch (error) {
      setConversationError(error.message || 'Unable to load conversations.');
      throw error;
    } finally {
      setConversationsLoading(false);
    }
  };

  const refreshAccountData = () => {
    if (!localStorage.getItem('chatsphere-token')) return;
    getUsers()
      .then(({ users }) => setContacts((users || []).map((contact) => ({ ...contact, id: contact._id, online: false }))))
      .catch((error) => {
        setContacts([]);
        setConversationError(`Contacts could not be loaded: ${error.message}`);
      });
    getTransactions()
      .then(({ transactions: records }) => setTransactions((records || []).map(mapTransaction)))
      .catch((error) => setConversationError(`Payment history could not be loaded: ${error.message}`));
  };

  useEffect(() => {
    const token = localStorage.getItem('chatsphere-token');
    if (!token) return;

    fetchProfile()
      .then(({ user }) => {
        setSessionUser(user);
        localStorage.setItem('chatsphere-user', JSON.stringify(user));
      })
      .catch((error) => {
        localStorage.removeItem('chatsphere-token');
        localStorage.removeItem('chatsphere-user');
        setSessionUser(currentUser);
        setLiveMode(false);
        setChats(initialChats);
        setContacts(initialContacts);
        setTransactions(initialTransactions);
        setConversationError(`Your session could not be restored: ${error.message}`);
      });
    refreshConversations().catch(() => {});
    refreshAccountData();
  }, []);

  const handleAuthenticated = async (user) => {
    setSessionUser(user);
    setLiveMode(true);
    setConversationError('');
    refreshAccountData();
    await refreshConversations().catch(() => {});
  };

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') {
      setNotificationStatus('Unavailable');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission === 'granted' ? 'Enabled' : permission === 'denied' ? 'Blocked' : 'Not enabled');
  };
  const setReadReceipts = (enabled) => {
    localStorage.setItem('chatsphere-read-receipts', String(enabled));
    setReadReceiptsEnabled(enabled);
  };

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage mode="login" onAuthenticated={handleAuthenticated} />} />
      <Route path="/register" element={<AuthPage mode="register" onAuthenticated={handleAuthenticated} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/dashboard"
        element={
          <DashboardPage
            chats={chats}
            setChats={setChats}
            liveMode={liveMode}
            loading={conversationsLoading}
            error={conversationError}
            refreshConversations={refreshConversations}
            readReceiptsEnabled={readReceiptsEnabled}
            user={sessionUser}
            theme={theme}
            toggleTheme={toggleTheme}
            notificationStatus={notificationStatus}
            onEnableNotifications={enableNotifications}
          />
        }
      />
      <Route
        path="/chat/:chatId"
        element={
          <DashboardPage
            chats={chats}
            setChats={setChats}
            liveMode={liveMode}
            loading={conversationsLoading}
            error={conversationError}
            refreshConversations={refreshConversations}
            readReceiptsEnabled={readReceiptsEnabled}
            user={sessionUser}
            theme={theme}
            toggleTheme={toggleTheme}
            notificationStatus={notificationStatus}
            onEnableNotifications={enableNotifications}
          />
        }
      />
      <Route path="/groups/new" element={<GroupCreatePage chats={chats} setChats={setChats} contacts={contacts} user={sessionUser} liveMode={liveMode} />} />
      <Route path="/groups/:groupId" element={<GroupDetailsPage chats={chats} setChats={setChats} contacts={contacts} user={sessionUser} liveMode={liveMode} />} />
      <Route path="/contacts" element={<ContactsPage contacts={contacts} chats={chats} setChats={setChats} liveMode={liveMode} />} />
      <Route path="/archived" element={<ArchivedChatsPage chats={chats} />} />
      <Route path="/payments" element={<PaymentCenterPage transactions={transactions} setTransactions={setTransactions} liveMode={liveMode} contacts={contacts} />} />
      <Route path="/payments/history" element={<TransactionHistoryPage transactions={transactions} />} />
      <Route path="/payments/receipt/:receiptId" element={<PaymentReceiptPage transactions={transactions} user={sessionUser} />} />
      <Route path="/profile" element={<ProfilePage user={sessionUser} setUser={setSessionUser} onLogout={() => {
        setSessionUser(currentUser);
        setLiveMode(false);
        setChats(initialChats);
        setContacts(initialContacts);
        setTransactions(initialTransactions);
      }} />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/privacy" element={<PrivacySettingsPage readReceiptsEnabled={readReceiptsEnabled} onReadReceiptsChange={setReadReceipts} notificationStatus={notificationStatus} onEnableNotifications={enableNotifications} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function LandingPage() {
  const featureList = [
    'Private individual and group chat rooms',
    'Voice notes, stickers, docs, and reactions',
    'Secure demo payment flow and receipts',
  ];

  return (
    <div className="landing-page shell-surface">
      <header className="landing-header">
        <Link className="brand" to="/">
          <div className="brand-mark">C</div>
          <span>ChatSphere</span>
        </Link>
        <nav className="landing-nav">
          <Link to="/login">Login</Link>
          <Link to="/register">Register</Link>
        </nav>
      </header>

      <main className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">Modern messaging for teams and communities</div>
          <h1>Comfortable conversations that feel premium.</h1>
          <p>
            ChatSphere brings together instant chat, thoughtful collaboration, payments, and polished
            user experiences in one clean workspace.
          </p>
          <div className="hero-actions">
            <Link className="primary-btn" to="/register">Create account</Link>
            <Link className="secondary-btn" to="/login">Open dashboard</Link>
          </div>
          <ul className="feature-list">
            {featureList.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>

        <div className="hero-preview card-elevated">
          <div className="preview-header">
            <div className="user-pill">
              <span className="online-dot" />
              Sofia Carter
            </div>
            <button className="tiny-button" type="button">
              <Bell size={14} />
            </button>
          </div>

          <div className="chat-bubbles">
            <div className="bubble incoming">The new onboarding flow is looking great.</div>
            <div className="bubble outgoing">I just finished the payment receipt polish.</div>
            <div className="bubble incoming">Perfect. Want me to check the voice note preview too?</div>
          </div>

          <div className="mini-stats">
            <div>
              <span>4.9/5</span>
              <small>User rating</small>
            </div>
            <div>
              <span>36k</span>
              <small>Messages</small>
            </div>
            <div>
              <span>120</span>
              <small>Payments</small>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function AuthPage({ mode, onAuthenticated }) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const isRegister = mode === 'register';

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isRegister && formData.password !== formData.confirmPassword) {
      setError('Passwords do not match. Please confirm your password.');
      return;
    }

    if (!formData.email || !formData.password || (isRegister && !formData.fullName)) {
      setError('Please complete all required fields before continuing.');
      return;
    }
    if (isRegister && (formData.fullName.trim().length < 2 || formData.fullName.trim().length > 80)) {
      setError('Your name must be between 2 and 80 characters.');
      return;
    }
    if (isRegister && formData.password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    try {
      setError('');
      setSubmitting(true);
      const payload = isRegister
        ? await registerUser({
            name: formData.fullName,
            email: formData.email,
            password: formData.password,
          })
        : await loginUser({
            email: formData.email,
            password: formData.password,
          });

      if (!payload?.token || !payload?.user) {
        throw new Error('The backend returned an incomplete authentication response.');
      }
      localStorage.setItem('chatsphere-token', payload.token);
      localStorage.setItem('chatsphere-user', JSON.stringify(payload.user));
      await onAuthenticated(payload.user);

      navigate('/dashboard');
    } catch (submitError) {
      setError(submitError.message || 'Unable to authenticate right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel card-elevated">
        <div className="auth-brand-row">
          <Link className="brand" to="/">
            <div className="brand-mark">C</div>
            <span>ChatSphere</span>
          </Link>
          <Link className="text-link" to="/">
            Back home
          </Link>
        </div>

        <div className="auth-heading">
          <h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2>
          <p>{isRegister ? 'Start building better conversations.' : 'Sign in to your workspace.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {isRegister && (
            <div className="field-group">
              <label htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Sofia Carter"
              />
            </div>
          )}

          <div className="field-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
            />
          </div>

          <div className="field-group">
            <label htmlFor="password">Password</label>
            <div className="input-with-action">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter password"
              />
              <button type="button" className="icon-button" onClick={() => setShowPassword((prev) => !prev)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {isRegister && (
            <div className="field-group">
              <label htmlFor="confirmPassword">Confirm password</label>
              <div className="input-with-action">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter password"
                />
                <button type="button" className="icon-button" onClick={() => setShowConfirm((prev) => !prev)}>
                  {showConfirm ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          )}

          {!isRegister && (
            <div className="inline-row auth-meta">
              <Link className="text-link" to="/forgot-password">
                Forgot password?
              </Link>
            </div>
          )}

          {error && <div className="error-message" role="alert">{error}</div>}

          <button type="submit" className="primary-btn block-button" disabled={submitting}>
            {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="divider"><span>or continue with</span></div>
        <div className="social-row">
          <button type="button" className="secondary-btn social-btn" disabled title="Google sign-in is not configured">
            Google
          </button>
          <button type="button" className="secondary-btn social-btn" disabled title="Apple sign-in is not configured">
            Apple
          </button>
        </div>

        <p className="auth-footer">
          {isRegister ? 'Already have an account?' : 'Need an account?'}{' '}
          <Link className="text-link" to={isRegister ? '/login' : '/register'}>
            {isRegister ? 'Log in' : 'Sign up'}
          </Link>
        </p>
      </div>
    </div>
  );
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div className="auth-page">
      <div className="auth-panel card-elevated">
        <div className="auth-brand-row">
          <Link className="brand" to="/">
            <div className="brand-mark">C</div>
            <span>ChatSphere</span>
          </Link>
          <Link className="text-link" to="/login">
            Back to login
          </Link>
        </div>

        <h2>Reset your password</h2>
        <p>Enter the email associated with your account to receive a reset link.</p>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSent(true);
          }}
        >
          <div className="field-group">
            <label htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <button type="submit" className="primary-btn block-button">
            Send reset link
          </button>
        </form>

        {sent && <div className="success-message">Password reset email is not configured for this demo. Contact the workspace administrator to recover access.</div>}
      </div>
    </div>
  );
}

function DashboardPage({
  chats,
  setChats,
  user = currentUser,
  liveMode,
  loading,
  error,
  refreshConversations,
  readReceiptsEnabled,
  theme,
  toggleTheme,
  notificationStatus,
  onEnableNotifications,
}) {
  const navigate = useNavigate();
  const { chatId } = useParams();
  const [selectedChatId, setSelectedChatId] = useState(chatId || chats.find((chat) => !chat.archived)?.id || '');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [search, setSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchResults, setMessageSearchResults] = useState(null);
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketError, setSocketError] = useState('');
  const [typingUser, setTypingUser] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [reactionPickerId, setReactionPickerId] = useState(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const socketRef = useRef(null);
  const joinedRoomRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const typingSendTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    if (chatId) {
      setSelectedChatId(chatId);
    }
  }, [chatId]);

  useEffect(() => {
    if (!chats.length || chats.some((chat) => chat.id === selectedChatId)) return;
    const fallback = chats.find((chat) => !chat.archived) || chats[0];
    setSelectedChatId(fallback.id);
    if (chatId && chatId !== fallback.id) navigate(`/chat/${fallback.id}`);
  }, [chats, selectedChatId, chatId, navigate]);

  const visibleChats = useMemo(() => {
    return chats.filter((chat) => !chat.archived && chat.name.toLowerCase().includes(search.toLowerCase()));
  }, [chats, search]);

  const activeChat = chats.find((chat) => chat.id === selectedChatId) || null;
  const displayedMessages = useMemo(() => {
    if (!messageSearch.trim()) return activeChat?.messages || [];
    if (liveMode) return messageSearchResults || [];
    const searchTerm = messageSearch.trim().toLowerCase();
    return (activeChat?.messages || []).filter((message) =>
      `${message.text || ''} ${message.attachment?.fileName || ''}`.toLowerCase().includes(searchTerm),
    );
  }, [activeChat?.messages, liveMode, messageSearch, messageSearchResults]);
  const activeChatIdRef = useRef(null);
  activeChatIdRef.current = activeChat?.id || null;

  const mergeMessage = (conversationId, incoming) => {
    if (!incoming) return;
    const normalized = mapMessage(incoming, user._id || user.id);
    setChats((previous) => previous.map((chat) => {
      if (chat.id !== conversationId) return chat;
      const nextMessages = chat.messages.filter((message) =>
        message.id !== normalized.id &&
        !(normalized.clientMessageId && message.clientMessageId === normalized.clientMessageId),
      );
      return {
        ...chat,
        lastMessage: normalized.text || normalized.attachment?.fileName || 'Attachment',
        lastMessageTime: normalized.time,
        messages: [...nextMessages, normalized].sort((a, b) => {
          const at = new Date(a.createdAt || a.time).getTime();
          const bt = new Date(b.createdAt || b.time).getTime();
          return at - bt;
        }),
      };
    }));
  };

  useEffect(() => {
    if (!liveMode) return undefined;
    const token = localStorage.getItem('chatsphere-token');
    if (!token) return undefined;

    const socket = io(socketBaseUrl, { auth: { token }, reconnection: true });
    socketRef.current = socket;
    socket.on('connect', () => {
      setSocketConnected(true);
      setSocketError('');
    });
    socket.on('disconnect', () => {
      setSocketConnected(false);
      joinedRoomRef.current = null;
    });
    socket.on('connect_error', (socketConnectError) => {
      setSocketConnected(false);
      setSocketError(socketConnectError.message || 'Real-time connection unavailable.');
    });
    socket.on('new-message', ({ conversationId, message }) => {
      mergeMessage(String(conversationId), message);
      setTypingUser('');
      if (
        String(conversationId) !== String(activeChatIdRef.current) &&
        String(message.sender?._id) !== String(user._id || user.id) &&
        notificationStatus === 'Enabled' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification(message.sender?.name || 'New message', {
          body: message.text || message.attachment?.fileName || 'Sent an attachment',
        });
      }
    });
    socket.on('conversation-message', ({ conversationId, message }) => {
      const conversationKey = String(conversationId);
      const normalized = mapMessage(message, user._id || user.id);
      const isActiveConversation = conversationKey === String(activeChatIdRef.current);
      const isOwnMessage = normalized.sender === 'me';
      setChats((previous) => previous.map((chat) => {
        if (chat.id !== conversationKey) return chat;
        const exists = chat.messages.some((item) =>
          item.id === normalized.id ||
          (normalized.clientMessageId && item.clientMessageId === normalized.clientMessageId),
        );
        const messages = exists
          ? chat.messages.map((item) => item.id === normalized.id ? normalized : item)
          : [...chat.messages, normalized];
        return {
          ...chat,
          lastMessage: normalized.text || normalized.attachment?.fileName || 'Attachment',
          lastMessageTime: normalized.time,
          unread: !exists && !isOwnMessage && !isActiveConversation ? chat.unread + 1 : chat.unread,
          messages,
        };
      }));
      if (
        !isOwnMessage &&
        !isActiveConversation &&
        notificationStatus === 'Enabled' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification(message.sender?.name || 'New message', {
          body: message.text || message.attachment?.fileName || 'Sent an attachment',
        });
      }
    });
    socket.on('message-updated', ({ conversationId, message }) => {
      const normalized = mapMessage(message, user._id || user.id);
      setChats((previous) => previous.map((chat) => chat.id === String(conversationId)
        ? { ...chat, messages: chat.messages.map((item) => item.id === normalized.id ? normalized : item) }
        : chat));
    });
    socket.on('message-deleted', ({ conversationId, messageId }) => {
      setChats((previous) => previous.map((chat) => chat.id === String(conversationId)
        ? { ...chat, messages: chat.messages.filter((item) => item.id !== messageId) }
        : chat));
    });
    socket.on('conversation-added', ({ conversation }) => {
      const mapped = mapConversation(conversation, user._id || user.id);
      setChats((previous) => [mapped, ...previous.filter((chat) => chat.id !== mapped.id)]);
    });
    socket.on('conversation-removed', ({ conversationId }) => {
      setChats((previous) => previous.filter((chat) => chat.id !== String(conversationId)));
    });
    socket.on('group-updated', ({ conversation }) => {
      const mapped = mapConversation(conversation, user._id || user.id);
      setChats((previous) => previous.map((chat) => chat.id === mapped.id ? { ...chat, ...mapped } : chat));
    });
    socket.on('read-receipt', ({ conversationId, userId, messageIds }) => {
      if (String(userId) === String(user._id || user.id)) return;
      setChats((previous) => previous.map((chat) => chat.id === String(conversationId)
        ? {
            ...chat,
            messages: chat.messages.map((message) =>
              message.sender === 'me' && (!messageIds.length || messageIds.includes(message.id))
                ? { ...message, status: 'Read' }
                : message,
            ),
          }
        : chat));
    });
    socket.on('typing', ({ conversationId, userId, isTyping }) => {
      if (String(conversationId) !== String(activeChatIdRef.current) || String(userId) === String(user._id || user.id)) return;
      setTypingUser(isTyping ? 'Someone' : '');
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTyping) typingTimeoutRef.current = setTimeout(() => setTypingUser(''), 2500);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      joinedRoomRef.current = null;
      setSocketConnected(false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (typingSendTimeoutRef.current) clearTimeout(typingSendTimeoutRef.current);
    };
  }, [liveMode, user._id, user.id, notificationStatus]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socketConnected) return;
    if (joinedRoomRef.current && joinedRoomRef.current !== activeChat?.id) {
      socket.emit('leave-room', String(joinedRoomRef.current));
      joinedRoomRef.current = null;
    }
    if (!activeChat) return;
    socket.emit('join-room', String(activeChat.id), (result) => {
      if (!result?.ok) setSocketError(result?.message || 'Could not join this conversation in real time.');
      else joinedRoomRef.current = activeChat.id;
    });
  }, [activeChat?.id, socketConnected]);

  useEffect(() => {
    if (!liveMode || !activeChat) return undefined;
    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError('');
    getMessages(activeChat.id)
      .then(({ messages }) => {
        if (cancelled) return;
        const mapped = (messages || []).map((message) => mapMessage(message, user._id || user.id));
        setChats((previous) => previous.map((chat) => chat.id === activeChat.id ? { ...chat, messages: mapped } : chat));
        const unreadIds = mapped.filter((message) => message.sender !== 'me' && message.status !== 'Read').map((message) => message.id);
        if (readReceiptsEnabled) {
          setChats((previous) => previous.map((chat) => chat.id === activeChat.id ? { ...chat, unread: 0 } : chat));
          if (unreadIds.length) markConversationRead(activeChat.id, unreadIds).catch((readError) => setMessagesError(readError.message));
        }
      })
      .catch((loadError) => {
        if (!cancelled) setMessagesError(loadError.message || 'Unable to load messages.');
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeChat?.id, liveMode, readReceiptsEnabled, user._id, user.id]);

  useEffect(() => {
    const searchTerm = messageSearch.trim();
    if (!liveMode || !activeChat || !searchTerm) {
      setMessageSearchResults(null);
      setMessageSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setMessageSearchLoading(true);
      getMessages(activeChat.id, { limit: 100, search: searchTerm })
        .then(({ messages }) => {
          if (!cancelled) setMessageSearchResults((messages || []).map((message) => mapMessage(message, user._id || user.id)));
        })
        .catch((searchError) => {
          if (!cancelled) {
            setMessageSearchResults([]);
            setMessagesError(searchError.message || 'Messages could not be searched.');
          }
        })
        .finally(() => {
          if (!cancelled) setMessageSearchLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeChat?.id, liveMode, messageSearch, user._id, user.id]);

  const joinOrNotifyTyping = (isTyping) => {
    const socket = socketRef.current;
    if (!socket || !activeChat || !socketConnected) return;
    if (typingSendTimeoutRef.current) clearTimeout(typingSendTimeoutRef.current);
    socket.emit('typing', { roomId: String(activeChat.id), isTyping });
    if (isTyping) {
      typingSendTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { roomId: String(activeChat.id), isTyping: false });
      }, 1500);
    }
  };

  const handleSend = async (messageType = 'text', content = draft) => {
    const trimmed = content.trim();
    if (!trimmed || !activeChat) return;

    if (liveMode) {
      const clientMessageId = crypto.randomUUID();
      setSending(true);
      setMessagesError('');
      try {
        const { message } = await sendMessage(activeChat.id, {
          text: trimmed,
          messageType,
          replyTo: replyingTo?.id || null,
          clientMessageId,
        });
        mergeMessage(activeChat.id, { ...message, clientMessageId });
        setDraft('');
        setReplyingTo(null);
        joinOrNotifyTyping(false);
      } catch (sendError) {
        setMessagesError(sendError.message || 'Message could not be sent.');
      } finally {
        setSending(false);
      }
      return;
    }

    const message = {
      id: `msg-${Date.now()}`,
      sender: 'me',
      text: trimmed,
      messageType,
      time: 'Now',
      status: 'Sent',
      reactions: {},
      replyTo: replyingTo,
    };

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              lastMessage: trimmed,
              lastMessageTime: 'Now',
              unread: 0,
              messages: [...chat.messages, message],
            }
          : chat,
      ),
    );

    setDraft('');
    setReplyingTo(null);
  };

  const toggleReaction = async (messageId, reactionName) => {
    if (liveMode) {
      try {
        const { message } = await toggleMessageReaction(activeChat.id, messageId, reactionName);
        const normalized = mapMessage(message, user._id || user.id);
        setChats((previous) => previous.map((chat) => chat.id === activeChat.id
          ? { ...chat, messages: chat.messages.map((item) => item.id === messageId ? normalized : item) }
          : chat));
      } catch (reactionError) {
        setMessagesError(reactionError.message || 'Reaction could not be saved.');
      }
      return;
    }
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== activeChat.id) return chat;
        return {
          ...chat,
          messages: chat.messages.map((message) => {
            if (message.id !== messageId) return message;
            const nextReactions = { ...message.reactions };
            nextReactions[reactionName] = (nextReactions[reactionName] || 0) + 1;
            return { ...message, reactions: nextReactions };
          }),
        };
      }),
    );
  };

  const handleEditMessage = async (messageId) => {
    const text = editDraft.trim();
    if (!text) return;
    try {
      const normalized = liveMode
        ? mapMessage((await editMessage(activeChat.id, messageId, text)).message, user._id || user.id)
        : { ...activeChat.messages.find((message) => message.id === messageId), text };
      setChats((previous) => previous.map((chat) => chat.id === activeChat.id
        ? { ...chat, messages: chat.messages.map((item) => item.id === messageId ? normalized : item) }
        : chat));
      setEditingMessageId(null);
      setEditDraft('');
    } catch (editError) {
      setMessagesError(editError.message || 'Message could not be edited.');
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      if (liveMode) await deleteMessage(activeChat.id, messageId);
      setChats((previous) => previous.map((chat) => chat.id === activeChat.id
        ? { ...chat, messages: chat.messages.filter((item) => item.id !== messageId) }
        : chat));
    } catch (deleteError) {
      setMessagesError(deleteError.message || 'Message could not be deleted.');
    }
  };

  const handleAttachment = async (file, messageType) => {
    if (!file || !activeChat) return;
    if (!liveMode) {
      setMessagesError('Sign in and connect the backend to send attachments.');
      return;
    }
    setSending(true);
    setMessagesError('');
    try {
      const { message } = await uploadMessageAttachment(activeChat.id, file, messageType, replyingTo?.id);
      mergeMessage(activeChat.id, message);
      setReplyingTo(null);
    } catch (uploadError) {
      setMessagesError(uploadError.message || 'Attachment could not be uploaded.');
    } finally {
      setSending(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessagesError('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        if (blob.size) handleAttachment(new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type }), 'voice');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setMessagesError('');
    } catch (recordError) {
      setMessagesError(recordError.message || 'Microphone permission was not granted.');
    }
  };

  const downloadAttachment = async (attachment) => {
    try {
      const apiOrigin = new URL(apiBaseUrl).origin;
      const downloadUrl = new URL(attachment.url, apiOrigin);
      if (downloadUrl.origin !== apiOrigin || !downloadUrl.pathname.startsWith('/api/uploads/')) {
        throw new Error('Attachment URL is invalid.');
      }
      const response = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${localStorage.getItem('chatsphere-token')}` },
      });
      if (!response.ok) throw new Error('Attachment download failed.');
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = attachment.fileName || 'attachment';
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      setMessagesError(downloadError.message || 'Attachment could not be downloaded.');
    }
  };

  const getThemeIcon = theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />;

  if (!activeChat) {
    return (
      <div className="page-shell">
        <div className="page-card card-elevated">
          <div className="page-header-row">
            <div>
              <small className="eyebrow">ChatSphere</small>
              <h2>{loading ? 'Loading conversations…' : 'No conversations yet'}</h2>
            </div>
            <Link className="text-link" to="/contacts">Find people</Link>
          </div>
          {error && <div className="error-message">{error}</div>}
          {!loading && !error && <p>Start a conversation from your contacts, or create a group.</p>}
          {error && <button type="button" className="secondary-btn" onClick={() => refreshConversations().catch(() => {})}>Retry</button>}
          <button type="button" className="primary-btn" onClick={() => navigate('/groups/new')}>Create a group</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar-shell card-elevated">
        <div className="sidebar-top">
          <Link className="brand" to="/">
            <div className="brand-mark">C</div>
            <span>ChatSphere</span>
          </Link>
          <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Toggle theme">
            {getThemeIcon}
          </button>
        </div>

        <div className="profile-card">
          <div className="avatar large accent-sky">{user.avatar || 'U'}</div>
          <div>
            <strong>{user.name}</strong>
            <small>{user.status}</small>
          </div>
        </div>

        <div className="sidebar-actions">
          <button className="primary-btn compact" type="button" onClick={() => navigate('/groups/new')}>
            <Plus size={16} /> New group
          </button>
          <button className="secondary-btn compact" type="button" onClick={() => navigate('/contacts')}>
            <User size={16} /> Contacts
          </button>
        </div>

        <label className="search-field">
          <Search size={16} />
          <input type="text" placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>

        <nav className="sidebar-nav">
          {navItems.map(({ label, to, icon: Icon }) => (
            <NavLink key={to} className="nav-link" to={to}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="section-heading-row">
          <span>Recent chats</span>
          <button type="button" className="ghost-button" onClick={() => navigate('/dashboard')}>View all</button>
        </div>

        <div className="chat-list">
          {visibleChats.length ? (
            visibleChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`chat-item ${chat.id === activeChat.id ? 'active' : ''}`}
                onClick={() => navigate(`/chat/${chat.id}`)}
              >
                <div className={`avatar accent-${chat.accent || 'sky'}`}>{chat.avatar}</div>
                <div className="chat-main">
                  <div className="chat-row">
                    <strong>{chat.name}</strong>
                    <span>{chat.lastMessageTime}</span>
                  </div>
                  <div className="chat-row muted">
                    <small>{chat.lastMessage}</small>
                    {chat.unread > 0 && <span className="badge">{chat.unread}</span>}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-state">No matching chats found.</div>
          )}
        </div>
      </aside>

      <main className="conversations-panel">
        <header className="conversation-header">
          <div className="header-user">
            <button type="button" className="icon-button mobile-only" onClick={() => navigate('/dashboard')}>
              <ArrowLeft size={16} />
            </button>
            <div className={`avatar accent-${activeChat.accent || 'sky'}`}>{activeChat.avatar}</div>
            <div>
              <h3>{activeChat.name}</h3>
              <small>{typingUser ? `${typingUser} is typing…` : liveMode ? (socketConnected ? activeChat.status : 'Offline · reconnecting…') : activeChat.status}</small>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Search messages"
              aria-expanded={messageSearchOpen}
              onClick={() => {
                setMessageSearchOpen((open) => !open);
                setMessageSearch('');
                setMessageSearchResults(null);
              }}
            >
              <Search size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Voice call" title="Voice calls are not configured" disabled>
              <Phone size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Video call" title="Video calls are not configured" disabled>
              <Video size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Toggle conversation details" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

        {messageSearchOpen && (
          <label className="search-field message-search-field">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search messages in this conversation"
              placeholder="Search messages in this conversation"
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
            />
            {messageSearchLoading && <small>Searching…</small>}
            {messageSearch && !messageSearchLoading && <small>{displayedMessages.length} result{displayedMessages.length === 1 ? '' : 's'}</small>}
          </label>
        )}

        <div className="message-list">
          {messagesLoading && <div className="empty-state">Loading messages…</div>}
          {messagesError && <div className="error-message" role="alert">{messagesError}</div>}
          {!messagesLoading && !messageSearchLoading && !displayedMessages.length && (
            <div className="empty-state">
              {messageSearch.trim() ? 'No messages matched your search.' : 'No messages yet. Say hello to start the conversation.'}
            </div>
          )}
          {displayedMessages.map((message) => {
            const isMine = message.sender === 'me' || message.sender === user.name;
            return (
              <div key={message.id} className={`message-row ${isMine ? 'mine' : ''}`}>
                <div className="message-bubble">
                  {message.replyTo && (
                    <div className="reply-preview">
                      <small>{message.replyTo.name}</small>
                      <span>{message.replyTo.text}</span>
                    </div>
                  )}
                  {editingMessageId === message.id ? (
                    <div className="edit-message-row">
                      <input value={editDraft} onChange={(event) => setEditDraft(event.target.value)} aria-label="Edit message" />
                      <button type="button" className="secondary-btn compact" onClick={() => handleEditMessage(message.id)}>Save</button>
                      <button type="button" className="icon-button" onClick={() => setEditingMessageId(null)} aria-label="Cancel edit"><X size={14} /></button>
                    </div>
                  ) : message.text ? <p className={message.messageType === 'sticker' ? 'sticker-message' : ''}>{message.text}</p> : null}
                  {message.attachment && (
                    <button type="button" className="attachment-link" onClick={() => downloadAttachment(message.attachment)}>
                      <FileText size={16} /> {message.attachment.fileName}
                    </button>
                  )}
                  <div className="message-meta">
                    <span>{message.time}</span>
                    {isMine && <span>{message.status}</span>}
                  </div>
                  <div className="reaction-row">
                    {Object.entries(message.reactions || {}).map(([key, value]) => (
                      <button key={key} type="button" className="reaction-pill" onClick={() => toggleReaction(message.id, key)}>
                        {key === 'heart' ? '❤' : key === 'thumbsUp' ? '👍' : key === 'laugh' ? '😂' : '😮'} {value}
                      </button>
                    ))}
                    <button type="button" className="reaction-pill icon-only" onClick={() => setReplyingTo({ name: isMine ? user.name : message.sender, text: message.text || message.attachment?.fileName || '', id: message.id })}>
                      <ReplyIcon />
                    </button>
                    <button type="button" className="reaction-pill icon-only" aria-label="Add reaction" onClick={() => setReactionPickerId(reactionPickerId === message.id ? null : message.id)}>
                      <Smile size={14} />
                    </button>
                    {isMine && (
                      <>
                        <button type="button" className="reaction-pill icon-only" aria-label="Edit message" onClick={() => { setEditingMessageId(message.id); setEditDraft(message.text); }}>
                          <Pencil size={13} />
                        </button>
                        <button type="button" className="reaction-pill icon-only" aria-label="Delete message" onClick={() => handleDeleteMessage(message.id)}>
                          <Trash size={13} />
                        </button>
                      </>
                    )}
                  </div>
                  {reactionPickerId === message.id && (
                    <div className="reaction-picker" aria-label="Choose a reaction">
                      {[
                        ['thumbsUp', '👍'],
                        ['heart', '❤️'],
                        ['laugh', '😂'],
                        ['surprise', '😮'],
                      ].map(([reaction, emoji]) => (
                        <button key={reaction} type="button" className="reaction-pill" onClick={() => { toggleReaction(message.id, reaction); setReactionPickerId(null); }}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {typingUser && <div className="typing-indicator">{typingUser} is typing…</div>}
        </div>

        <div className="composer-wrap">
          {liveMode && !socketConnected && <div className="offline-notice">{socketError || 'Real-time updates are offline. Message sending still uses the API.'}</div>}
          {liveMode && socketConnected && <div className="connection-status">Live connection</div>}
          {replyingTo && (
            <div className="reply-box">
              <div>
                <small>Replying to {replyingTo.name}</small>
                <p>{replyingTo.text}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setReplyingTo(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          {emojiPickerOpen && (
            <div className="emoji-sticker-picker" aria-label="Emoji and sticker picker">
              <strong>Emoji</strong>
              {['😊', '😂', '❤️', '👍', '🎉', '🙌', '🔥', '🥳'].map((emoji) => (
                <button key={emoji} type="button" className="reaction-pill" onClick={() => { setDraft((current) => `${current}${current ? ' ' : ''}${emoji}`); setEmojiPickerOpen(false); }}>
                  {emoji}
                </button>
              ))}
              <strong>Stickers</strong>
              {['🎉🎉', '🙌✨', '💖', '🚀'].map((sticker, index) => (
                <button key={`${sticker}-${index}`} type="button" className="sticker-option" onClick={() => { void handleSend('sticker', sticker); setEmojiPickerOpen(false); }}>
                  {sticker}
                </button>
              ))}
            </div>
          )}

          <div className="composer-row">
            <button type="button" className="icon-button" aria-label="Select emoji or sticker" onClick={() => setEmojiPickerOpen((open) => !open)}>
              <Smile size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Attach file" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Add image" onClick={() => imageInputRef.current?.click()}>
              <ImageIcon size={16} />
            </button>
            <button type="button" className={`icon-button ${recording ? 'recording' : ''}`} aria-label={recording ? 'Stop voice note' : 'Record voice note'} onClick={toggleRecording}>
              <Mic size={16} />
            </button>
            <input ref={fileInputRef} hidden type="file" accept=".pdf,.doc,.docx,audio/*" onChange={(event) => { handleAttachment(event.target.files?.[0], event.target.files?.[0]?.type.startsWith('audio/') ? 'voice' : 'document'); event.target.value = ''; }} />
            <input ref={imageInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { handleAttachment(event.target.files?.[0], 'image'); event.target.value = ''; }} />

            <input
              type="text"
              className="composer-input"
              placeholder="Type a message..."
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (liveMode) joinOrNotifyTyping(Boolean(e.target.value.trim()));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />

            <button type="button" className="primary-btn compact" onClick={() => void handleSend()} disabled={sending}>
              <Send size={16} /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </main>

      {detailsOpen && <aside className="details-panel card-elevated">
        <div className="details-header">
          <h4>Conversation details</h4>
          <button type="button" className="icon-button" aria-label="Open settings" onClick={() => navigate(activeChat.type === 'group' ? `/groups/${activeChat.id}` : '/settings')}>
            <Settings size={16} />
          </button>
        </div>

        <div className="detail-card">
          <h5>Shared features</h5>
          <ul>
            <li>Emoji picker</li>
            <li>Sticker panel</li>
            <li>Voice message support</li>
            <li>Private replies</li>
          </ul>
        </div>

        <div className="detail-card">
          <h5>Participants</h5>
          {activeChat.type === 'group' ? (
            <div className="member-list">
              {(activeChat.members || []).map((member) => (
                <span key={member._id || member}>{member.name || (String(member._id || member) === String(user._id || user.id) ? user.name : 'Group member')}</span>
              ))}
              {liveMode && <Link className="text-link" to={`/groups/${activeChat.id}`}>Manage group</Link>}
            </div>
          ) : (
            <div className="member-list">
              <span>{activeChat.name}</span>
              <span>{user.name}</span>
            </div>
          )}
        </div>

        <div className="detail-card">
          <h5>Quick actions</h5>
          <div className="stack-buttons">
            <button type="button" className="secondary-btn compact" onClick={() => navigate('/settings')}>
              <Settings size={16} /> Settings
            </button>
            <button type="button" className="secondary-btn compact" onClick={() => navigate('/privacy')}>
              <ShieldCheck size={16} /> Privacy
            </button>
            <button type="button" className="secondary-btn compact" onClick={onEnableNotifications}>
              <Bell size={16} /> {notificationStatus}
            </button>
          </div>
        </div>
      </aside>}
    </div>
  );
}

function GroupCreatePage({ chats, setChats, contacts, user, liveMode }) {
  const navigate = useNavigate();
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const handleMemberToggle = (contactId) => {
    setSelectedMembers((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId],
    );
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      setError('Enter a group name before creating the group.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      let newGroup;
      if (liveMode) {
        const { group } = await createGroup({ name: groupName.trim(), members: selectedMembers });
        newGroup = mapConversation(group, user._id || user.id);
      } else {
        newGroup = {
          id: `group-${Date.now()}`,
          type: 'group',
          name: groupName.trim(),
          avatar: 'G',
          accent: 'violet',
          online: false,
          status: `${selectedMembers.length + 1} members`,
          lastMessage: 'Group created successfully.',
          lastMessageTime: 'Now',
          unread: 0,
          pinned: false,
          muted: false,
          archived: false,
          members: [],
          admins: [],
          messages: [{ id: `group-msg-${Date.now()}`, sender: 'System', text: 'Welcome to the new group chat.', time: 'Now', status: 'Sent', reactions: {} }],
        };
      }
      setChats((previous) => [newGroup, ...previous.filter((chat) => chat.id !== newGroup.id)]);
      navigate(`/groups/${newGroup.id}`);
    } catch (createError) {
      setError(createError.message || 'Group could not be created.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <div className="page-header-row">
          <div>
            <small className="eyebrow">Group creation</small>
            <h2>Build a new group</h2>
          </div>
          <Link className="text-link" to="/dashboard">
            Back to chats
          </Link>
        </div>

        <div className="form-grid two-column">
          <div className="field-group">
            <label htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Design studio" 
            />
          </div>

          <div className="field-group">
            <label htmlFor="group-image">Group image</label>
            <input id="group-image" type="text" value="Initials avatar generated from the group name" readOnly />
          </div>
        </div>

        <div className="field-group">
          <label>Select members</label>
          <div className="member-selector">
            {contacts.map((member) => (
              <button
                key={member._id || member.id}
                type="button"
                className={`member-option ${selectedMembers.includes(member._id || member.id) ? 'selected' : ''}`}
                onClick={() => handleMemberToggle(member._id || member.id)}
              >
                <span className="avatar accent-sky">{member.avatar || member.name.slice(0, 1)}</span>
                <span>{member.name}</span>
                {selectedMembers.includes(member._id || member.id) && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>

        {!contacts.length && liveMode && <div className="empty-state">No other registered users are available yet. You can still create this group for yourself.</div>}
        {error && <div className="error-message" role="alert">{error}</div>}
        <button type="button" className="primary-btn" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create group'}
        </button>
      </div>
    </div>
  );
}

function GroupDetailsPage({ chats, setChats, contacts, user, liveMode }) {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [memberToAdd, setMemberToAdd] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const group = chats.find((chat) => chat.id === groupId && chat.type === 'group');

  if (!group) {
    return <NotFoundPage />;
  }

  const userId = user._id || user.id;
  const isAdmin = group.admins?.some((admin) => String(admin._id || admin) === String(userId));
  const members = group.members || [];
  const availableContacts = contacts.filter((contact) =>
    !members.some((member) => String(member._id || member) === String(contact._id || contact.id)),
  );

  const changeMember = async (action, targetId) => {
    setWorking(true);
    setError('');
    try {
      const { group: updatedGroup } = await updateGroupMembers(groupId, action, targetId);
      const mapped = mapConversation(updatedGroup, userId);
      setChats((previous) => previous.map((chat) => chat.id === groupId ? { ...chat, ...mapped } : chat));
      setMemberToAdd('');
    } catch (changeError) {
      setError(changeError.message || 'Group membership could not be updated.');
    } finally {
      setWorking(false);
    }
  };

  const changeAdmin = async (action, targetId) => {
    setWorking(true);
    setError('');
    try {
      const { group: updatedGroup } = await updateGroupAdmin(groupId, action, targetId);
      const mapped = mapConversation(updatedGroup, userId);
      setChats((previous) => previous.map((chat) => chat.id === groupId ? { ...chat, ...mapped } : chat));
    } catch (changeError) {
      setError(changeError.message || 'Administrator permissions could not be updated.');
    } finally {
      setWorking(false);
    }
  };

  const handleLeave = async () => {
    if (!window.confirm(`Leave ${group.name}?`)) return;
    setWorking(true);
    setError('');
    try {
      if (liveMode) await leaveGroup(groupId);
      setChats((previous) => previous.filter((chat) => chat.id !== groupId));
      navigate('/dashboard');
    } catch (leaveError) {
      setError(leaveError.message || 'Could not leave this group.');
      setWorking(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <div className="page-header-row">
          <div className="header-user">
            <div className="avatar accent-violet">{group.avatar}</div>
            <div>
              <small className="eyebrow">Group details</small>
              <h2>{group.name}</h2>
            </div>
          </div>
          <Link className="text-link" to="/dashboard">
            Open chat
          </Link>
        </div>

        <div className="detail-grid">
          <div className="detail-card">
            <h5>Group overview</h5>
            <p>{group.status}</p>
            <ul>
              <li>Members: {members.length || 1}</li>
              <li>Admins: {group.admins?.length || 1}</li>
              <li>Notifications: On</li>
            </ul>
          </div>

          <div className="detail-card">
            <h5>Members</h5>
            <div className="member-list">
              {members.map((member) => (
                <div key={member._id || member} className="member-management-row">
                  <span>
                    {member.name || (String(member._id || member) === String(userId) ? user.name : 'Group member')}
                    {group.admins?.some((admin) => String(admin._id || admin) === String(member._id || member)) ? ' · Admin' : ''}
                  </span>
                  {isAdmin && String(member._id || member) !== String(userId) && (
                    <div className="member-actions">
                      <button
                        type="button"
                        className="text-link"
                        disabled={working}
                        onClick={() => changeAdmin(
                          group.admins?.some((admin) => String(admin._id || admin) === String(member._id || member)) ? 'demote' : 'promote',
                          member._id || member,
                        )}
                      >
                        {group.admins?.some((admin) => String(admin._id || admin) === String(member._id || member)) ? 'Remove admin' : 'Make admin'}
                      </button>
                      <button type="button" className="text-link" disabled={working} onClick={() => changeMember('remove', member._id || member)}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        {isAdmin && availableContacts.length > 0 && (
          <div className="member-management-row">
            <select aria-label="Choose member to add" value={memberToAdd} onChange={(event) => setMemberToAdd(event.target.value)}>
              <option value="">Choose a person to add</option>
              {availableContacts.map((contact) => <option key={contact._id || contact.id} value={contact._id || contact.id}>{contact.name}</option>)}
            </select>
            <button type="button" className="secondary-btn compact" disabled={!memberToAdd || working} onClick={() => changeMember('add', memberToAdd)}>Add member</button>
          </div>
        )}
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="button-row">
          <button type="button" className="secondary-btn" disabled={working} onClick={handleLeave}>Leave group</button>
          <Link className="primary-btn" to={`/chat/${group.id}`}>Open group chat</Link>
        </div>
      </div>
    </div>
  );
}

function ContactsPage({ contacts, chats, setChats, liveMode }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState('');
  const startConversation = async (contact) => {
    setError('');
    if (!liveMode) {
      const existingChat = chats.find((chat) => chat.name === contact.name);
      if (existingChat) navigate(`/chat/${existingChat.id}`);
      else setError('Sign in to start a conversation with this contact.');
      return;
    }
    const contactId = contact._id || contact.id;
    setWorkingId(contactId);
    try {
      const { conversation } = await createConversation({ participantId: contactId, type: 'individual' });
      const storedUser = getStoredUser();
      const mapped = mapConversation(conversation, storedUser._id || storedUser.id);
      setChats((previous) => [mapped, ...previous.filter((chat) => chat.id !== mapped.id)]);
      navigate(`/chat/${mapped.id}`);
    } catch (startError) {
      setError(startError.message || 'Could not start the conversation.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <div className="page-header-row">
          <div>
            <small className="eyebrow">People</small>
            <h2>Contacts</h2>
          </div>
          <Link className="text-link" to="/dashboard">Return to dashboard</Link>
        </div>

        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="contact-grid">
          {contacts.map((person) => (
            <div key={person._id || person.id} className="contact-card">
              <div className="avatar accent-sky">{person.avatar || person.name.slice(0, 1)}</div>
              <div>
                <strong>{person.name}</strong>
                <small>{person.status}</small>
              </div>
              <div className="contact-meta">
                <span>{person.online ? 'Online' : 'Offline'}</span>
                <button type="button" className="secondary-btn compact" disabled={workingId === (person._id || person.id)} onClick={() => startConversation(person)}>
                  {workingId === (person._id || person.id) ? 'Opening…' : 'Message'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArchivedChatsPage({ chats }) {
  const archived = chats.filter((chat) => chat.archived);

  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <div className="page-header-row">
          <div>
            <small className="eyebrow">Inbox</small>
            <h2>Archived chats</h2>
          </div>
          <Link className="text-link" to="/dashboard">Back to chats</Link>
        </div>

        {archived.length ? (
          <div className="stack-list">
            {archived.map((chat) => (
              <div key={chat.id} className="list-row">
                <div className={`avatar accent-${chat.accent}`}>{chat.avatar}</div>
                <div>
                  <strong>{chat.name}</strong>
                  <small>{chat.lastMessage}</small>
                </div>
                <span>{chat.lastMessageTime}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No archived conversations yet.</div>
        )}
      </div>
    </div>
  );
}

function PaymentCenterPage({ transactions, setTransactions, liveMode, contacts }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ recipient: demoRecipients[0].value, amount: '', note: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (liveMode && contacts.length && !contacts.some((contact) => (contact._id || contact.id) === form.recipient)) {
      setForm((previous) => ({ ...previous, recipient: contacts[0]._id || contacts[0].id }));
    }
  }, [liveMode, contacts, form.recipient]);

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const parsedAmount = Number(form.amount);

    if (!form.recipient || !form.amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Please select a valid recipient and enter a payment amount greater than zero.');
      return;
    }

    setSubmitting(true);
    setError('');
    if (liveMode) {
      try {
        const { transaction: created } = await createDemoPayment({
          recipientId: form.recipient,
          amount: parsedAmount,
          paymentNote: form.note,
        });
        const { transaction: verified } = await verifyDemoPayment(created._id);
        const mappedTransaction = mapTransaction(verified);
        setTransactions((previous) => [mappedTransaction, ...previous.filter((item) => item.id !== mappedTransaction.id)]);
        navigate(`/payments/receipt/${mappedTransaction.id}`);
      } catch (paymentError) {
        setError(paymentError.message || 'The demo payment could not be processed.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const newTransaction = {
      id: `txn-${Date.now()}`,
      recipient: demoRecipients.find((item) => item.value === form.recipient)?.label || 'Unknown contact',
      amount: parsedAmount,
      note: form.note || 'Demo payment',
      date: new Date().toISOString().slice(0, 10),
      status: 'Pending',
      reference: `CS-${Date.now()}`,
      paymentMethod: 'Demo wallet transfer',
    };

    setTransactions((prev) => [newTransaction, ...prev]);
    setSubmitting(false);
    navigate(`/payments/receipt/${newTransaction.id}`);
  };

  return (
    <div className="page-shell">
      <div className="page-card card-elevated payment-layout">
        <div>
          <small className="eyebrow">Payments</small>
          <h2>Send a demo payment</h2>
          <p className="subtle-copy">This flow is for frontend simulation only. No real money is transferred.</p>

          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="recipient">Recipient</label>
              <select id="recipient" name="recipient" value={form.recipient} onChange={handleChange}>
                {(liveMode ? contacts.map((contact) => ({ value: contact._id || contact.id, label: contact.name })) : demoRecipients).map((recipient) => (
                  <option key={recipient.value} value={recipient.value}>
                    {recipient.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="amount">Amount (USD)</label>
              <input
                id="amount"
                name="amount"
                type="number"
                min="1"
                step="0.01"
                value={form.amount}
                onChange={handleChange}
                placeholder="125.00"
              />
            </div>

            <div className="field-group">
              <label htmlFor="note">Payment note</label>
              <textarea id="note" name="note" rows="3" value={form.note} onChange={handleChange} placeholder="Optional message for the recipient" />
            </div>

            {liveMode && !contacts.length && <div className="empty-state">No registered recipients are available for demo payments.</div>}
            {error && <div className="error-message" role="alert">{error}</div>}

            <div className="button-row">
              <button type="submit" className="primary-btn" disabled={submitting || (liveMode && !contacts.length)}>{submitting ? 'Processing…' : 'Confirm payment'}</button>
              <Link to="/payments/history" className="secondary-btn compact">History</Link>
            </div>
          </form>
        </div>

        <div className="summary-card">
          <div className="summary-label">Quick summary</div>
          <div className="summary-number">{formatCurrency(form.amount || 0)}</div>
          <div className="summary-row">
            <span>Payment status</span>
            <strong>Demo pending</strong>
          </div>
          <div className="summary-row">
            <span>Processing</span>
            <strong>Frontend simulation</strong>
          </div>
          <div className="summary-row">
            <span>Receipt</span>
            <strong>Generated after verification</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionHistoryPage({ transactions }) {
  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <div className="page-header-row">
          <div>
            <small className="eyebrow">Transactions</small>
            <h2>Payment history</h2>
          </div>
          <Link className="text-link" to="/payments">Send new payment</Link>
        </div>

        {transactions.length ? (
          <div className="stack-list">
            {transactions.map((transaction) => (
              <div key={transaction.id} className="list-row transaction-row">
                <div>
                  <strong>{transaction.recipient}</strong>
                  <small>{transaction.reference}</small>
                </div>
                <div>
                  <strong>{formatCurrency(transaction.amount)}</strong>
                  <small>{transaction.status}</small>
                </div>
                <Link className="text-link" to={`/payments/receipt/${transaction.id}`}>Receipt</Link>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No demo payments have been recorded.</div>}
      </div>
    </div>
  );
}

function PaymentReceiptPage({ transactions, user = currentUser }) {
  const { receiptId } = useParams();
  const transaction = transactions.find((item) => item.id === receiptId);
  const navigate = useNavigate();

  if (!transaction) {
    return <NotFoundPage />;
  }

  return (
    <div className="page-shell">
      <div className="page-card card-elevated receipt-page">
        <div className="page-header-row">
          <div>
            <small className="eyebrow">Payment receipt</small>
            <h2>Transaction details</h2>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-btn compact" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </button>
            <button type="button" className="secondary-btn compact" onClick={() => window.print()}>
              <Download size={16} /> Download PDF
            </button>
          </div>
        </div>

        <div className="receipt-card">
          <div className="receipt-header">
            <div className="brand">
              <div className="brand-mark">C</div>
              <span>ChatSphere</span>
            </div>
            <span className={`status-badge ${transaction.status.toLowerCase()}`}>{transaction.status}</span>
          </div>

          <div className="receipt-grid">
            <div>
              <span className="detail-label">Reference</span>
              <strong>{transaction.reference}</strong>
            </div>
            <div>
              <span className="detail-label">Date</span>
              <strong>{transaction.date}</strong>
            </div>
            <div>
              <span className="detail-label">Sender</span>
              <strong>{user.name}</strong>
            </div>
            <div>
              <span className="detail-label">Recipient</span>
              <strong>{transaction.recipient}</strong>
            </div>
            <div>
              <span className="detail-label">Amount</span>
              <strong>{formatCurrency(transaction.amount)}</strong>
            </div>
            <div>
              <span className="detail-label">Method</span>
              <strong>{transaction.paymentMethod}</strong>
            </div>
          </div>

          <div className="receipt-note">
            <span className="detail-label">Note</span>
            <p>{transaction.note}</p>
          </div>
        </div>

        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={() => navigate('/payments/history')}>
            Back to history
          </button>
          <button type="button" className="primary-btn" onClick={() => navigate('/dashboard')}>
            Continue to chats
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilePage({ user, setUser, onLogout }) {
  const navigate = useNavigate();
  const [name, setName] = useState(user.name || '');
  const [status, setStatus] = useState(user.status || '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setName(user.name || '');
    setStatus(user.status || '');
  }, [user.name, user.status]);

  const saveProfile = async () => {
    if (!name.trim()) {
      setError('Your name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updatedUser = localStorage.getItem('chatsphere-token')
        ? (await updateProfile({ name: name.trim(), status: status.trim() })).user
        : { ...user, name: name.trim(), status: status.trim() };
      setUser(updatedUser);
      localStorage.setItem('chatsphere-user', JSON.stringify(updatedUser));
      setSaved(true);
    } catch (saveError) {
      setError(saveError.message || 'Profile changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setError('');
    try {
      if (localStorage.getItem('chatsphere-token')) await logoutUser();
    } catch (logoutError) {
      setError(`Signed out locally; server logout did not complete: ${logoutError.message}`);
    } finally {
      localStorage.removeItem('chatsphere-token');
      localStorage.removeItem('chatsphere-user');
      onLogout();
      navigate('/login');
    }
  };

  return (
    <div className="page-shell">
      <div className="page-card card-elevated profile-card-layout">
        <div className="profile-summary">
          <div className="avatar large accent-sky">{user.avatar || 'U'}</div>
          <div>
            <h2>{name}</h2>
            <p>{status}</p>
          </div>
        </div>

        <div className="form-grid two-column">
          <div className="field-group">
            <label htmlFor="profile-name">Full name</label>
            <input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field-group">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" value={user.email || ''} readOnly />
          </div>
          <div className="field-group">
            <label htmlFor="profile-status">Status</label>
            <input id="profile-status" value={status} onChange={(event) => setStatus(event.target.value)} />
          </div>
          <div className="field-group">
            <label htmlFor="profile-id">Account ID</label>
            <input id="profile-id" value={user._id || user.id || ''} readOnly />
          </div>
        </div>

        {error && <div className="error-message" role="alert">{error}</div>}
        {saved && <div className="success-message">Profile changes saved.</div>}
        <div className="button-row">
          <button type="button" className="primary-btn" disabled={saving} onClick={saveProfile}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="secondary-btn" disabled={loggingOut} onClick={handleLogout}>
            <LogOut size={16} /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <small className="eyebrow">Account</small>
        <h2>General settings</h2>
        <div className="settings-grid">
          <div className="setting-box">
            <User size={18} />
            <div>
              <strong>Profile</strong>
              <small>Manage account and contact details</small>
            </div>
            <Link className="text-link" to="/profile">Open</Link>
          </div>
          <div className="setting-box">
            <Bell size={18} />
            <div>
              <strong>Notifications</strong>
              <small>Sound, badges, and browser alerts</small>
            </div>
            <Link className="text-link" to="/privacy">Open</Link>
          </div>
          <div className="setting-box">
            <Lock size={18} />
            <div>
              <strong>Privacy</strong>
              <small>Last-seen, read receipts, and access</small>
            </div>
            <Link className="text-link" to="/privacy">Open</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacySettingsPage({ readReceiptsEnabled, onReadReceiptsChange, notificationStatus, onEnableNotifications }) {
  const [lastSeenVisibility, setLastSeenVisibility] = useState(() => localStorage.getItem('chatsphere-last-seen') || 'Contacts only');
  const [notificationError, setNotificationError] = useState('');

  const requestNotifications = async () => {
    setNotificationError('');
    try {
      await onEnableNotifications();
    } catch (error) {
      setNotificationError(error.message || 'Browser notification permission could not be requested.');
    }
  };

  return (
    <div className="page-shell">
      <div className="page-card card-elevated">
        <small className="eyebrow">Privacy</small>
        <h2>Privacy and notification settings</h2>
        <div className="stack-list settings-list">
          <div className="toggle-row">
            <div>
              <strong>Read receipts</strong>
              <small>Show when your messages have been opened</small>
            </div>
            <button type="button" className={`toggle-pill ${readReceiptsEnabled ? 'on' : 'off'}`} aria-pressed={readReceiptsEnabled} onClick={() => onReadReceiptsChange(!readReceiptsEnabled)}>
              {readReceiptsEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Last seen visibility</strong>
              <small>Choose who can see your last online time</small>
            </div>
            <button
              type="button"
              className={`toggle-pill ${lastSeenVisibility === 'Everyone' ? 'on' : 'off'}`}
              aria-pressed={lastSeenVisibility === 'Everyone'}
              onClick={() => {
                const nextValue = lastSeenVisibility === 'Everyone' ? 'Contacts only' : 'Everyone';
                localStorage.setItem('chatsphere-last-seen', nextValue);
                setLastSeenVisibility(nextValue);
              }}
            >
              {lastSeenVisibility}
            </button>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Browser notification support</strong>
              <small>Enable push-style alerts when permission is granted</small>
            </div>
            <button type="button" className={`toggle-pill ${notificationStatus === 'Enabled' ? 'on' : 'off'}`} onClick={requestNotifications}>
              {notificationStatus === 'Enabled' ? 'Enabled' : notificationStatus === 'Blocked' ? 'Blocked in browser' : notificationStatus === 'Unavailable' ? 'Unavailable' : 'Enable'}
            </button>
          </div>
        </div>
        {notificationError && <div className="error-message" role="alert">{notificationError}</div>}
        <p className="subtle-copy">Privacy options are stored in this browser. Read receipts are applied to live message reads.</p>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-panel card-elevated not-found-box">
        <small className="eyebrow">404</small>
        <h2>Page not found</h2>
        <p>The page you are looking for does not exist in this demo app.</p>
        <Link className="primary-btn" to="/dashboard">Go to dashboard</Link>
      </div>
    </div>
  );
}

function ReplyIcon() {
  return <ChevronRight size={14} />;
}

export default App;

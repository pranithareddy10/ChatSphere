const mongoose = require('mongoose');

function sanitizeErrorMessage(message) {
  return String(message || 'No error message provided.')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB connection string redacted]')
    .slice(0, 500);
}

function diagnoseConnectionError(error) {
  const failures = [error];
  const nestedServers = error.reason?.servers;
  if (nestedServers) {
    failures.push(...Array.from(nestedServers.values(), (server) => server.error).filter(Boolean));
  }
  const codes = failures.map((failure) => String(failure.code || '')).filter(Boolean);
  const details = failures.map((failure) => `${failure.name || ''} ${failure.message || ''}`).join(' ');

  if (codes.includes('18') || /authentication failed|bad auth/i.test(details)) {
    return {
      category: 'authentication_failed',
      action: 'Check the Atlas database username and password; URL-encode special characters in the password.',
    };
  }
  if (/not whitelisted|IP address|network access/i.test(details)) {
    return {
      category: 'network_access_denied',
      action: 'Add this machine public IP to Atlas Network Access, or verify the deployment host access rule.',
    };
  }
  if (codes.some((code) => ['EBADRESP', 'ENOTFOUND', 'ESERVFAIL'].includes(code)) || /querySrv/i.test(details)) {
    return {
      category: 'dns_resolution_failed',
      action: 'Check the Atlas cluster hostname, DNS resolver, and network/VPN settings; SRV lookup did not succeed.',
    };
  }
  if (failures.some((failure) => failure.name === 'MongoParseError')) {
    return {
      category: 'invalid_connection_uri',
      action: 'Copy the Atlas Node.js connection string and verify its scheme, username, password encoding, and database name.',
    };
  }
  if (codes.some((code) => ['ETIMEDOUT', 'ETIMEOUT'].includes(code)) || /server selection timed out|timed out/i.test(details)) {
    return {
      category: 'connection_timeout',
      action: 'Check Atlas cluster availability, Network Access rules, and outbound firewall access.',
    };
  }

  return {
    category: 'connection_failed',
    action: 'Check Atlas cluster status, Network Access, database credentials, and the Node.js connection string.',
  };
}

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;

  if (typeof mongoUri !== 'string' || !mongoUri.trim() || /<[^>]+>/.test(mongoUri)) {
    console.error('MongoDB connection not attempted: MONGODB_URI is missing or still contains example placeholders.');
    return false;
  }

  try {
    await mongoose.connect(mongoUri.trim(), {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('MongoDB connected successfully.');
    return true;
  } catch (error) {
    const diagnostic = diagnoseConnectionError(error);
    console.error('MongoDB connection failed:', {
      category: diagnostic.category,
      errorName: error.name || 'Error',
      errorCode: error.code || null,
      errorMessage: sanitizeErrorMessage(error.message),
      action: diagnostic.action,
    });
    return false;
  }
}

module.exports = { connectDB, diagnoseConnectionError, sanitizeErrorMessage };

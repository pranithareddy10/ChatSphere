function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Unexpected server error.';
  const safeLogMessage = String(err.message || 'Unexpected server error.')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB connection string redacted]');

  if (err.name === 'ValidationError' || err.name === 'CastError' || err.type === 'entity.parse.failed') {
    statusCode = 400;
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'A record with this value already exists.';
  }

  if (statusCode >= 500) {
    console.error('Request failed:', safeLogMessage);
    message = 'Unexpected server error.';
  }
  res.status(statusCode).json({
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };

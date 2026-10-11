const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    avatar: {
      type: String,
      default: 'CU',
    },
    status: {
      type: String,
      default: 'Available',
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  const userObject = this.toObject();
  delete userObject.passwordHash;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);

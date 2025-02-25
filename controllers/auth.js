const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const _ = require('lodash');
const joi = require('joi');
const Auth = require('../model/auth');
const User = require('../model/user');
const google_auth_library = require('google-auth-library');

/**
 * @author Cyril ogoh <cyrilogoh@gmail.com>
 * @description Registeration using Form Input For `All Account Type`
 * @route `/api/v1/auth/register`
 * @access Public
 * @type POST
 */
exports.register = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.body.email) {
      return next(new ErrorResponse('Email Address Is Required', 403));
    }
    const email = req.body.email.toLowerCase()
      ? req.body.email.toLowerCase()
      : '';
    const opts = { session, new: true };
    const checkAccount = await Auth.findOne({
      email: email
    });

    if (!_.isEmpty(checkAccount)) {
      return next(new ErrorResponse('Email Address already exist', 400));
    }
    // Create an Authication Profile
    const authProfile = await Auth.create(
      [
        {
          email: email,
          password: req.body.password
        }
      ],
      opts
    );

    await authProfile[0].save();

    // Create a User Profile
    const user = await User.create(
      [
        {
          email: email,
          auth_id: authProfile[0]._id,
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          user_type: req.body.user_type,
          gender: req.body.gender
        }
      ],
      opts
    );

    // update Auth With Th User Data
    await Auth.findOneAndUpdate(
      { _id: authProfile[0]._id },
      {
        userID: user[0]._id
      },
      { new: true, runValidators: true, session: session }
    );

    // TODO Send Verification Mail  -- Maybe
    // TODO Send Welcome Mail
    await session.commitTransaction();
    session.endSession();
    sendTokenResponse(user, 200, res);
  } catch (error) {
    session.endSession();
    next(error);
  }
});

/**
 * @author Cyril ogoh <cyrilogoh@gmail.com>
 * @description Login using Form Input
 * @route `/api/v1/auth/login`
 * @access Public
 * @type POST
 */
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  // Validate email & password
  //TODO use Joi
  if (!email || !password) {
    return next(new ErrorResponse('Please provide an email and password', 400));
  }

  // Check for user
  const auth = await Auth.findOne({ email }).select('+password');

  if (!auth) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if password matches
  const isMatch = await bcrypt.compare(password, auth.password);

  if (!isMatch) {
    return next(new ErrorResponse('Invalid credentials', 401));
  } else {
    const user = await User.findOne({ email: auth.email });

    sendTokenResponse(user, 200, res);
  }
});

/**
 * @author Cyril ogoh <cyrilogoh@gmail.com>
 * @description Logout
 * @route `/api/v1/auth/logout`
 * @access Public
 * @type GET
 */
exports.logout = asyncHandler(async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    data: {}
  });
});

/**
 * @author Cyril ogoh <cyrilogoh@gmail.com>
 * @description Forgot Password
 * @route `/api/v1/auth/forgot-password`
 * @access Public
 * @type POST
 */
exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const { generateOTP } = require('../utils/otpGen');
  const user = await Auth.findOne({ email: req.body.email.toLowerCase() });

  if (!user) {
    return next(new ErrorResponse('There is no user with that email', 404));
  }

  // Get reset token
  const resetToken = generateOTP(6);
  user.resetPasswordToken = resetToken;
  await user.save({ validateBeforeSave: false });

  console.log(resetToken);

  try {
    //TODO Send email

    res.status(200).json({ success: true, data: 'Email sent successfully' });
  } catch (err) {
    console.log(`email error `, err);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });

    return next(new ErrorResponse('Email could not be sent', 500));
  }
});

/**
 * @author Cyril ogoh <cyrilogoh@gmail.com>
 * @description Reset Password
 * @route `/api/v1/auth/reset-password`
 * @access Public
 * @type POST
 */
exports.resetPassword = asyncHandler(async (req, res, next) => {
  const { email, new_password } = req.body;
  const user = await User.findOne({
    email: email
  });

  if (!user) {
    return next(
      new ErrorResponse(`User with this email ${email} does not exist`, 400)
    );
  }

  // Set new password
  user.password = new_password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// Get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
  // Create token
  const token = Array.isArray(user)
    ? user[0].getSignedJwtToken()
    : user.getSignedJwtToken();

  const options = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000
    ),
    httpOnly: true
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token,
      user: Array.isArray(user) ? user[0] : user
    });
};

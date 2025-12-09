import React, { useState, useEffect } from 'react';
import emailjs from '@emailjs/browser';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

// EmailJS configuration
const EMAILJS_SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID || 'service_rltt2o9';
const EMAILJS_TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID || 'template_bj1va2w';
const EMAILJS_PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY || 'GsEMmAKjKPLWQ91Eu';

// Initialize EmailJS
if (EMAILJS_PUBLIC_KEY) {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

export default function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordErrors, setPasswordErrors] = useState([]);

  // Check for OAuth callback tokens in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const refreshToken = urlParams.get('refreshToken');

    if (token && refreshToken) {
      localStorage.setItem('authToken', token);
      localStorage.setItem('refreshToken', refreshToken);

      // Fetch user profile
      fetchUserProfile(token);

      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchUserProfile = async (token) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.data));
        onLogin(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
    }
  };

  const validatePassword = (password) => {
    const errors = [];
    if (password.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/\d/.test(password)) errors.push('One number');
    if (!/[@$!%*?&#^()_+\-=\[\]{}|;:'",.<>\/~`]/.test(password)) errors.push('One special character');
    return errors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    if (name === 'password' && !isLogin) {
      setPasswordErrors(validatePassword(value));
    }
  };

  const sendVerificationEmail = async (email, name) => {
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();

      console.log('Sending verification email to:', email);

      const result = await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        {
          email: email,
          reply_to: email,
          subject: 'Verify your email - Collaborative Text Editor',
          message: `Hi ${name},\n\nYour verification code is: ${code}\n\nPlease enter this code to complete your registration.\n\nBest regards,\nCollaborative Text Editor Team`,
          verification_code: code,
          user_name: name
        },
        EMAILJS_PUBLIC_KEY
      );

      console.log('Email sent successfully:', result);

      // Store verification code locally (in production, store on server)
      sessionStorage.setItem('verificationCode', code);
      sessionStorage.setItem('verificationEmail', email);

      return true;
    } catch (err) {
      console.error('Email failed:', err);
      return false;
    }
  };

  const handleVerification = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const storedCode = sessionStorage.getItem('verificationCode');
    const storedEmail = sessionStorage.getItem('verificationEmail');

    if (verificationCode.toUpperCase() !== storedCode || formData.email !== storedEmail) {
      setError('Invalid verification code');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          verificationCode: verificationCode
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Verification failed');
      }

      setSuccess('Email verified! Logging you in...');

      // Now perform login automatically
      const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password
        }),
      });

      const loginData = await loginResponse.json();

      if (!loginResponse.ok) {
        throw new Error(loginData.message || 'Login failed after verification');
      }

      // Store tokens
      localStorage.setItem('authToken', loginData.data.token);
      if (loginData.data.refreshToken) {
        localStorage.setItem('refreshToken', loginData.data.refreshToken);
      }
      localStorage.setItem('user', JSON.stringify(loginData.data));

      onLogin(loginData.data);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    // Validate password on registration
    if (!isLogin) {
      const errors = validatePassword(formData.password);
      if (errors.length > 0) {
        setError('Password does not meet requirements');
        setPasswordErrors(errors);
        setLoading(false);
        return;
      }
    }

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed');
      }

      if (!isLogin) {
        // Registration successful
        const emailSent = await sendVerificationEmail(formData.email, formData.name);
        if (emailSent) {
          setSuccess('Account created! Please enter the verification code sent to your email.');
          setIsVerifying(true);
        } else {
          setError('Account created but failed to send email. Please try logging in.');
          setIsLogin(true);
        }
      } else {
        // Login successful
        localStorage.setItem('authToken', data.data.token);
        if (data.data.refreshToken) {
          localStorage.setItem('refreshToken', data.data.refreshToken);
        }
        localStorage.setItem('user', JSON.stringify(data.data));
        onLogin(data.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // Redirect to Google OAuth
    window.location.href = `${API_BASE_URL}/api/auth/auth/google`;
  };

  if (isVerifying) {
    return (
      <div style={{
        maxWidth: '400px',
        margin: '50px auto',
        padding: '30px',
        border: '1px solid #e0e0e0',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px', color: '#333' }}>
          Verify Email
        </h2>

        <div style={{ marginBottom: '20px', textAlign: 'center', color: '#666' }}>
          We sent a code to <strong>{formData.email}</strong>
        </div>

        {error && (
          <div style={{
            color: '#d32f2f',
            backgroundColor: '#ffebee',
            marginBottom: '16px',
            padding: '12px',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            color: '#2e7d32',
            backgroundColor: '#e8f5e9',
            marginBottom: '16px',
            padding: '12px',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {success}
          </div>
        )}

        <form onSubmit={handleVerification}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '4px' }}>
              Verification Code
            </label>
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="Enter 6-character code"
              required
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
                textAlign: 'center',
                letterSpacing: '2px',
                textTransform: 'uppercase'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: loading ? '#ccc' : '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            onClick={() => setIsVerifying(false)}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '400px',
      margin: '50px auto',
      padding: '30px',
      border: '1px solid #e0e0e0',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '24px', color: '#333' }}>
        {isLogin ? 'Welcome Back' : 'Create Account'}
      </h2>

      {error && (
        <div style={{
          color: '#d32f2f',
          backgroundColor: '#ffebee',
          marginBottom: '16px',
          padding: '12px',
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{
          color: '#2e7d32',
          backgroundColor: '#e8f5e9',
          marginBottom: '16px',
          padding: '12px',
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          {success}
        </div>
      )}

      {/* Google Login Button */}
      <button
        type="button"
        onClick={handleGoogleLogin}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: '#fff',
          color: '#333',
          border: '1px solid #ddd',
          borderRadius: '6px',
          cursor: 'pointer',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          fontSize: '14px',
          fontWeight: '500'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
          <path fill="#34A853" d="M9.003 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.26c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009.003 18z" />
          <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
          <path fill="#EA4335" d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.002 0A8.997 8.997 0 00.957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z" />
        </svg>
        Continue with Google
      </button>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        margin: '20px 0',
        color: '#999'
      }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#ddd' }}></div>
        <span style={{ padding: '0 16px', fontSize: '12px' }}>OR</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#ddd' }}></div>
      </div>

      <form onSubmit={handleSubmit}>
        {!isLogin && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '4px' }}>
              Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required={!isLogin}
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '4px' }}>
            Email
          </label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '4px' }}>
            Password
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            style={{
              width: '100%',
              padding: '12px',
              border: `1px solid ${!isLogin && passwordErrors.length > 0 ? '#f44336' : '#ddd'}`,
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
          {!isLogin && passwordErrors.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#f44336' }}>
              <div>Password must have:</div>
              {passwordErrors.map((err, i) => (
                <div key={i} style={{ marginLeft: '8px' }}>• {err}</div>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || (!isLogin && passwordErrors.length > 0)}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: loading ? '#ccc' : '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button
          onClick={() => {
            setIsLogin(!isLogin);
            setError('');
            setPasswordErrors([]);
          }}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#1976d2',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

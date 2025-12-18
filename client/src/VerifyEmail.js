import React, { useEffect, useState } from 'react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function VerifyEmail({ onVerified }) {
    const [status, setStatus] = useState('verifying');
    const [message, setMessage] = useState('Verifying your email...');

    useEffect(() => {
        const verifyEmail = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            const email = urlParams.get('email');

            if (!token || !email) {
                setStatus('error');
                setMessage('Invalid verification link. Please check your email and try again.');
                return;
            }

            // Verify the token matches what was stored (client-side verification)
            const storedToken = sessionStorage.getItem('verificationToken');
            const storedEmail = sessionStorage.getItem('verificationEmail');

            // If no stored token, the user might be on a different browser/device
            // In production, you would verify against the server
            if (!storedToken || storedEmail !== email) {
                // For now, we'll trust the link and proceed with server verification
                console.log('No stored token found, proceeding with server verification');
            } else if (token !== storedToken) {
                setStatus('error');
                setMessage('Invalid or expired verification link.');
                return;
            }

            try {
                // Call the backend to verify email
                const response = await fetch(`${API_BASE_URL}/api/auth/verify-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: email,
                        verificationToken: token
                    }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || 'Verification failed');
                }

                setStatus('success');
                setMessage('Email verified successfully! Redirecting to login...');

                // Clear stored verification data
                sessionStorage.removeItem('verificationToken');
                sessionStorage.removeItem('verificationEmail');

                // Redirect to login after 2 seconds
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);

            } catch (err) {
                setStatus('error');
                setMessage(err.message || 'Verification failed. Please try again.');
            }
        };

        verifyEmail();
    }, []);

    return (
        <div style={{
            maxWidth: '400px',
            margin: '100px auto',
            padding: '30px',
            textAlign: 'center',
            border: '1px solid #e0e0e0',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}>
            {status === 'verifying' && (
                <>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        border: '4px solid #e0e0e0',
                        borderTop: '4px solid #1976d2',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto 20px'
                    }} />
                    <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
                </>
            )}

            {status === 'success' && (
                <div style={{
                    width: '50px',
                    height: '50px',
                    backgroundColor: '#e8f5e9',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px'
                }}>
                    <span style={{ color: '#2e7d32', fontSize: '24px' }}>✓</span>
                </div>
            )}

            {status === 'error' && (
                <div style={{
                    width: '50px',
                    height: '50px',
                    backgroundColor: '#ffebee',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px'
                }}>
                    <span style={{ color: '#d32f2f', fontSize: '24px' }}>✗</span>
                </div>
            )}

            <h2 style={{
                color: status === 'error' ? '#d32f2f' : status === 'success' ? '#2e7d32' : '#333',
                marginBottom: '16px'
            }}>
                {status === 'verifying' ? 'Verifying...' : status === 'success' ? 'Success!' : 'Error'}
            </h2>

            <p style={{ color: '#666', marginBottom: '20px' }}>
                {message}
            </p>

            {status === 'error' && (
                <button
                    onClick={() => window.location.href = '/'}
                    style={{
                        padding: '12px 24px',
                        backgroundColor: '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px'
                    }}
                >
                    Back to Login
                </button>
            )}
        </div>
    );
}

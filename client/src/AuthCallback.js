import React, { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function AuthCallback({ onLogin }) {
    const [status, setStatus] = useState('Processing...');
    const history = useHistory();
    const location = useLocation();

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const token = params.get('token');
        const refreshToken = params.get('refreshToken');
        const error = params.get('error');

        if (error) {
            setStatus(`Authentication failed: ${error}`);
            setTimeout(() => history.push('/'), 3000);
            return;
        }

        if (token && refreshToken) {
            // Store tokens
            localStorage.setItem('authToken', token);
            localStorage.setItem('refreshToken', refreshToken);

            // Fetch user profile
            fetchProfile(token);
        } else {
            setStatus('Invalid callback parameters');
            setTimeout(() => history.push('/'), 3000);
        }
    }, [location, history]);

    const fetchProfile = async (token) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await response.json();

            if (data.success) {
                localStorage.setItem('user', JSON.stringify(data.data));
                setStatus('Login successful! Redirecting...');
                onLogin(data.data);
                history.push('/');
            } else {
                throw new Error('Failed to fetch profile');
            }
        } catch (err) {
            setStatus('Failed to complete login');
            setTimeout(() => history.push('/'), 3000);
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            fontFamily: 'sans-serif'
        }}>
            <div style={{
                padding: '40px',
                borderRadius: '12px',
                backgroundColor: '#f5f5f5',
                textAlign: 'center'
            }}>
                <div style={{
                    width: '40px',
                    height: '40px',
                    border: '4px solid #1976d2',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 20px'
                }} />
                <p style={{ color: '#666', margin: 0 }}>{status}</p>
            </div>
            <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}

import React from 'react'
import "quill/dist/quill.snow.css"
import { useCallback, useEffect, useState, useRef } from "react"
import Quill from "quill"
import { io } from "socket.io-client"
import { useParams } from "react-router-dom"

const interval_ms = 2000

// Cursor module for Quill
const Cursor = Quill.import('blots/inline');
class CursorBlot extends Cursor {
  static create(value) {
    const node = super.create();
    node.setAttribute('data-user-id', value.userId);
    node.style.backgroundColor = value.color || '#ffeb3b';
    node.style.position = 'relative';
    return node;
  }
}
CursorBlot.blotName = 'cursor';
CursorBlot.tagName = 'span';

export default function TextEditor() {
  const { id: id_doc } = useParams()
  const [newsocket, setSocket] = useState()
  const [quill, setQuill] = useState()
  const [version, setVersion] = useState(1)
  const [activeUsers, setActiveUsers] = useState([])
  const [currentUser, setCurrentUser] = useState(null)
  const [remoteCursors, setRemoteCursors] = useState({})
  const cursorOverlaysRef = useRef({})

  console.log(id_doc)

  // Socket connection
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      console.error('No auth token found');
      return;
    }

    const s = io(process.env.REACT_APP_COLLAB_URL || 'http://localhost', {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling']
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  // Socket event handlers for presence and collaboration
  useEffect(() => {
    if (newsocket == null || quill == null) return;

    const joinRoom = () => {
      console.log('Connected to collaboration service, joining document:', id_doc);
      newsocket.emit('join-document', id_doc);
    };

    // Handle successful document join
    const handleDocumentJoined = (data) => {
      console.log('Document joined, active sessions:', data.sessions);
      setActiveUsers(data.sessions || []);

      // Find current user from sessions
      const token = localStorage.getItem('authToken');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const me = data.sessions?.find(u => u.userId === payload.userId?.toString());
          setCurrentUser(me || { userId: payload.userId });
        } catch (e) {
          console.error('Error parsing token:', e);
        }
      }
    };

    // Handle user joined
    const handleUserJoined = (data) => {
      console.log('User joined:', data);
      setActiveUsers(prev => {
        const exists = prev.find(u => String(u.userId) === String(data.userId));
        if (exists) return prev;
        return [...prev, { userId: String(data.userId), name: data.name, color: data.color || getColorForUser(data.userId) }];
      });
    };

    // Handle user left
    const handleUserLeft = (data) => {
      console.log('User left:', data);
      setActiveUsers(prev => prev.filter(u => u.userId !== data.userId));
      // Remove their cursor
      setRemoteCursors(prev => {
        const newCursors = { ...prev };
        delete newCursors[data.userId];
        return newCursors;
      });
      // Remove cursor overlay
      if (cursorOverlaysRef.current[data.userId]) {
        cursorOverlaysRef.current[data.userId].remove();
        delete cursorOverlaysRef.current[data.userId];
      }
    };

    // Handle cursor updates from other users
    const handleCursorUpdate = (data) => {
      console.log('Cursor update from user:', data.userId, 'position:', data.position);
      setRemoteCursors(prev => ({
        ...prev,
        [data.userId]: {
          position: data.position,
          selection: data.selection,
          color: data.color || getColorForUser(data.userId)
        }
      }));
    };

    // Handle receiving changes from other users
    const handleReceiveChanges = (data) => {
      console.log('Received changes from user:', data.userId);
      quill.updateContents(data.operation);
      setVersion(data.version);
    };

    // Handle connection errors
    const handleConnectError = (error) => {
      console.error('Socket connection error:', error);
    };

    const handleError = (error) => {
      console.error('Socket error:', error);
    };

    // Load document content
    const loadDocument = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost'}/api/documents/${id_doc}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const result = await response.json();
          // API returns { success, data: document, message } where document has { id, title, data, ... }
          const documentContent = result.data?.data;
          console.log('Loading document content from document service:', documentContent);
          if (documentContent) {
            quill.setContents(documentContent);
          } else {
            quill.setText('');
          }
          quill.enable();
        } else {
          console.error('Failed to load document:', response.status);
          quill.setText('');
          quill.enable();
        }
      } catch (error) {
        console.error('Error loading document:', error);
        quill.enable();
      }
    };

    // Register event handlers
    newsocket.on('connect', joinRoom);
    newsocket.on('connect_error', handleConnectError);
    newsocket.on('error', handleError);
    newsocket.on('document-joined', handleDocumentJoined);
    newsocket.on('user-joined', handleUserJoined);
    newsocket.on('user-left', handleUserLeft);
    newsocket.on('cursor-update', handleCursorUpdate);
    newsocket.on('receive-changes', handleReceiveChanges);

    // If already connected, join room
    if (newsocket.connected) {
      joinRoom();
    }

    // Load document content
    loadDocument();

    return () => {
      newsocket.off('connect', joinRoom);
      newsocket.off('connect_error', handleConnectError);
      newsocket.off('error', handleError);
      newsocket.off('document-joined', handleDocumentJoined);
      newsocket.off('user-joined', handleUserJoined);
      newsocket.off('user-left', handleUserLeft);
      newsocket.off('cursor-update', handleCursorUpdate);
      newsocket.off('receive-changes', handleReceiveChanges);
    };
  }, [newsocket, quill, id_doc]);

  // Render remote cursors
  useEffect(() => {
    if (!quill) return;

    const editorContainer = quill.root;

    Object.entries(remoteCursors).forEach(([userId, cursorData]) => {
      if (userId === currentUser?.userId?.toString()) return; // Don't show own cursor

      let cursorEl = cursorOverlaysRef.current[userId];

      if (!cursorEl) {
        // Create cursor element
        cursorEl = document.createElement('div');
        cursorEl.className = 'remote-cursor';
        cursorEl.innerHTML = `
          <div class="cursor-caret" style="background-color: ${cursorData.color}"></div>
          <div class="cursor-label" style="background-color: ${cursorData.color}">${userId}</div>
        `;
        editorContainer.parentNode.appendChild(cursorEl);
        cursorOverlaysRef.current[userId] = cursorEl;
      }

      // Position cursor
      try {
        const bounds = quill.getBounds(cursorData.position);
        if (bounds) {
          cursorEl.style.position = 'absolute';
          cursorEl.style.left = `${bounds.left}px`;
          cursorEl.style.top = `${bounds.top}px`;
          cursorEl.style.height = `${bounds.height}px`;
          cursorEl.style.display = 'block';
        }
      } catch (e) {
        console.error('Error positioning cursor:', e);
      }
    });

    // Clean up cursors for users who left
    Object.keys(cursorOverlaysRef.current).forEach(userId => {
      if (!remoteCursors[userId]) {
        cursorOverlaysRef.current[userId].remove();
        delete cursorOverlaysRef.current[userId];
      }
    });
  }, [remoteCursors, quill, currentUser]);

  // Handle local text changes
  useEffect(() => {
    if (newsocket == null || quill == null) return;

    const handleTextChange = (delta, oldDelta, source) => {
      if (source !== 'user') return;

      const newVersion = version + 1;
      setVersion(newVersion);

      newsocket.emit('send-changes', {
        documentId: id_doc,
        operation: delta,
        version: newVersion
      });
    };

    quill.on('text-change', handleTextChange);

    return () => {
      quill.off('text-change', handleTextChange);
    };
  }, [newsocket, quill, id_doc, version]);

  // Periodic document saving
  useEffect(() => {
    if (quill == null) return;

    const saveInterval = setInterval(async () => {
      const content = quill.getContents();
      const text = quill.getText();

      if (text.trim()) {
        try {
          const token = localStorage.getItem('authToken');
          const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost'}/api/documents/${id_doc}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              data: content,
              title: text.split('\n')[0].substring(0, 100) || 'Untitled Document'
            })
          });

          if (response.ok) {
            console.log('Document saved successfully');
          } else {
            console.error('Failed to save document:', response.statusText);
          }
        } catch (error) {
          console.error('Error saving document:', error);
        }
      }
    }, 3000);

    return () => clearInterval(saveInterval);
  }, [quill, id_doc]);

  // Save on page unload
  useEffect(() => {
    if (quill == null) return;

    const handleBeforeUnload = async () => {
      const content = quill.getContents();
      const text = quill.getText();

      if (text.trim()) {
        try {
          const token = localStorage.getItem('authToken');
          await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost'}/api/documents/${id_doc}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              data: content,
              title: text.split('\n')[0].substring(0, 100) || 'Untitled Document'
            }),
            keepalive: true
          });
        } catch (error) {
          console.error('Error saving document on unload:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [quill, id_doc]);

  // Handle cursor movements
  useEffect(() => {
    if (newsocket == null || quill == null) return;

    const handleSelectionChange = (range, oldRange, source) => {
      if (source === 'user' && range) {
        newsocket.emit('cursor-move', {
          documentId: id_doc,
          position: range.index,
          selection: range.length > 0 ? { start: range.index, end: range.index + range.length } : null
        });
      }
    };

    quill.on('selection-change', handleSelectionChange);

    return () => {
      quill.off('selection-change', handleSelectionChange);
    };
  }, [newsocket, quill, id_doc]);

  const wrapperReference = useCallback(wrapper => {
    if (wrapper == null) return
    wrapper.innerHTML = ""
    const editor = document.createElement("div")
    wrapper.append(editor)
    const q_quill = new Quill(editor, { theme: "snow", modules: { toolbar: ToolBarArea } })
    q_quill.disable()
    q_quill.setText("Loading............")
    setQuill(q_quill)
  }, [])

  return (
    <div className="editor-container">
      <div className="presence-bar">
        <div className="active-users">
          {activeUsers.map(user => (
            <div
              key={user.userId}
              className={`user-badge ${user.userId === currentUser?.userId?.toString() ? 'me' : ''}`}
              title={user.name || `User ${user.userId}`}
              style={{ backgroundColor: user.color || getColorForUser(user.userId) }}
            >
              {(user.name || user.userId?.toString() || '?').substring(0, 1).toUpperCase()}
              {user.userId === currentUser?.userId?.toString() && <span className="me-label">(You)</span>}
            </div>
          ))}
        </div>
        <div className="user-count">
          {activeUsers.length} user{activeUsers.length !== 1 ? 's' : ''} online
        </div>
      </div>
      <div className="container" ref={wrapperReference}></div>
      <style>{`
        .editor-container {
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .presence-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16px;
          background: #f5f5f5;
          border-bottom: 1px solid #ddd;
        }
        .active-users {
          display: flex;
          gap: 8px;
        }
        .user-badge {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 14px;
          position: relative;
          cursor: pointer;
        }
        .user-badge.me {
          border: 2px solid #333;
        }
        .me-label {
          position: absolute;
          bottom: -16px;
          font-size: 10px;
          color: #333;
          white-space: nowrap;
        }
        .user-count {
          font-size: 12px;
          color: #666;
        }
        .remote-cursor {
          position: absolute;
          pointer-events: none;
          z-index: 1000;
        }
        .cursor-caret {
          width: 2px;
          height: 100%;
          animation: blink 1s infinite;
        }
        .cursor-label {
          position: absolute;
          top: -18px;
          left: 0;
          padding: 2px 6px;
          border-radius: 3px;
          color: white;
          font-size: 11px;
          white-space: nowrap;
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .container {
          flex: 1;
          overflow: auto;
        }
      `}</style>
    </div>
  )
}

// Generate consistent color for user
function getColorForUser(userId) {
  const colors = [
    '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
    '#2196f3', '#03a9f4', '#00bcd4', '#009688',
    '#4caf50', '#8bc34a', '#cddc39', '#ffc107',
    '#ff9800', '#ff5722', '#795548', '#607d8b'
  ];
  const hash = String(userId).split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

const ToolBarArea = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  [{ font: [] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["bold", "italic", "underline"],
  [{ color: ['#ffffff', 'orange'] }, { background: ['#ffffff'] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  ["image", "blockquote", "code-block"],
  ["clean"],
]
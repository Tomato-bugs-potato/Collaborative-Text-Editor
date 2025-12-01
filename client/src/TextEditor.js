import React from 'react'
import "quill/dist/quill.snow.css"
import { useCallback, useEffect, useState } from "react"
import Quill from "quill"
import { io } from "socket.io-client"
import { useParams } from "react-router-dom"

const interval_ms = 2000


export default function TextEditor() {
  const { id: id_doc } = useParams()
  const [newsocket, setSocket] = useState()
  const [quill, setQuill] = useState()
  const [version, setVersion] = useState(1)

  console.log(id_doc)


  //UseEffect1
  useEffect(() => {
    // Get JWT token from localStorage (assuming user is logged in)
    const token = localStorage.getItem('authToken');

    if (!token) {
      console.error('No authentication token found. Please log in first.');
      return;
    }

    // Connect to collaboration service through API Gateway
    const s_socket = io(process.env.REACT_APP_COLLABORATION_URL || 'http://localhost:4000', {
      auth: {
        token: token
      }
    });

    setSocket(s_socket);

    return () => {
      s_socket.disconnect();
    };

  }, [])


  //UseEffect2: Handle incoming changes from other users
  useEffect(() => {
    if (newsocket == null || quill == null) return;

    const handleReceiveChanges = (data) => {
      quill.updateContents(data.operation);
    };

    newsocket.on("receive-changes", handleReceiveChanges);

    return () => {
      newsocket.off("receive-changes", handleReceiveChanges);
    };
  }, [newsocket, quill]);

  //UseEffect3: Send local changes to other users
  useEffect(() => {
    if (newsocket == null || quill == null) return;

    const handleTextChange = (delta, oldDelta, source) => {
      if (source !== "user") return;

      newsocket.emit("send-changes", {
        documentId: id_doc,
        operation: delta,
        version: version
      });

      setVersion(prev => prev + 1);
    };

    quill.on("text-change", handleTextChange);

    return () => {
      quill.off("text-change", handleTextChange);
    };
  }, [newsocket, quill, id_doc]);

  //useEffect4: Load document content and join collaboration
  useEffect(() => {
    if (quill == null) return;

    // First, load document content from document service
    const loadDocumentContent = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${process.env.REACT_APP_DOCUMENTS_URL || 'http://localhost:3002'}/documents/${id_doc}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data && data.data.data) {
            console.log("Loading document content from document service:", data.data.data);
            quill.setContents(data.data.data);
            quill.enable();
          } else {
            console.log("No content found, starting with empty document");
            quill.enable();
          }
        } else {
          console.error("Failed to load document content");
          quill.enable();
        }
      } catch (error) {
        console.error("Error loading document content:", error);
        quill.enable();
      }
    };

    loadDocumentContent();

    // Then join collaboration session
    if (newsocket != null) {
      newsocket.emit("join-document", id_doc);

      // Handle successful document join
      newsocket.on("document-joined", (data) => {
        console.log("Joined document collaboration:", data);
        // Don't re-enable quill here since it's already enabled after loading
      });

      // Handle document loading from collaboration service (if available)
      newsocket.on("load-document", (content) => {
        console.log("Received content from collaboration service:", content);
        if (content && content.ops && content.ops.length > 0) {
          quill.setContents(content);
        }
      });
    }

  }, [newsocket, quill, id_doc]);

  //useEffect4.5: Periodic document saving
  useEffect(() => {
    if (quill == null) return;

    const saveInterval = setInterval(async () => {
      const content = quill.getContents();
      const text = quill.getText();

      if (text.trim()) { // Only save if there's actual content
        try {
          const token = localStorage.getItem('authToken');
          const response = await fetch(`${process.env.REACT_APP_DOCUMENTS_URL || 'http://localhost:3002'}/documents/${id_doc}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              data: content,
              title: text.split('\n')[0].substring(0, 100) || 'Untitled Document' // Use first line as title
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
    }, 3000); // Save every 3 seconds

    return () => clearInterval(saveInterval);
  }, [quill, id_doc]);

  //useEffect4.6: Save on page unload
  useEffect(() => {
    if (quill == null) return;

    const handleBeforeUnload = async () => {
      const content = quill.getContents();
      const text = quill.getText();

      if (text.trim()) {
        try {
          const token = localStorage.getItem('authToken');
          await fetch(`${process.env.REACT_APP_DOCUMENTS_URL || 'http://localhost:3002'}/documents/${id_doc}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              data: content,
              title: text.split('\n')[0].substring(0, 100) || 'Untitled Document'
            }),
            keepalive: true // Ensure request completes even if page is unloading
          });
        } catch (error) {
          console.error('Error saving document on unload:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [quill, id_doc]);

  //useEffect5: Handle cursor movements (optional)
  useEffect(() => {
    if (newsocket == null || quill == null) return;

    const handleSelectionChange = (range, oldRange, source) => {
      if (source === 'user' && range) {
        newsocket.emit("cursor-move", {
          documentId: id_doc,
          position: range.index,
          selection: range.length > 0 ? { start: range.index, end: range.index + range.length } : null
        });
      }
    };

    quill.on("selection-change", handleSelectionChange);

    return () => {
      quill.off("selection-change", handleSelectionChange);
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
  return <div className="container" ref={wrapperReference}></div>


}


const ToolBarArea = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  [{ font: [] }], //Default font used in quill
  [{ list: "ordered" }, { list: "bullet" }],
  ["bold", "italic", "underline"],
  [{ color: ['#ffffff','orange'] }, { background: ['#ffffff'] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  ["image", "blockquote", "code-block"],
  ["clean"],
]
import { useEffect, useRef } from "react";
import socket from "./socket"; // already connected socket.io client

const VideoCall = () => {
  // ===============================
  // REFS
  // ===============================
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ===============================
  // 1️⃣ CAMERA + MIC START
  // ===============================
  const startCamera = async () => {
    if (localStreamRef.current) return; // already started

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    localStreamRef.current = stream;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  };

  // ===============================
  // 2️⃣ CREATE PEER CONNECTION
  // ===============================
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Local media add
    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // Remote video receive
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // ICE candidates send
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", event.candidate);
      }
    };

    // 🔁 RECONNECT DETECTION
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("Connection state:", state);

      if (state === "disconnected" || state === "failed") {
        reconnectCall();
      }
    };

    pcRef.current = pc;
  };

  // ===============================
  // 3️⃣ START CALL (CALLER)
  // ===============================
  const startCall = async () => {
    await startCamera();
    createPeerConnection();

    const pc = pcRef.current!;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", offer);
  };

  // ===============================
  // 4️⃣ AUDIO MUTE / UNMUTE
  // ===============================
  const toggleAudio = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
  };

  // ===============================
  // 5️⃣ VIDEO MUTE / UNMUTE
  // ===============================
  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
  };

  // ===============================
  // 6️⃣ SCREEN SHARE START
  // ===============================
  const startScreenShare = async () => {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    const screenTrack = screenStream.getVideoTracks()[0];

    const sender = pcRef.current
      ?.getSenders()
      .find((s) => s.track?.kind === "video");

    // Camera → Screen replace
    sender?.replaceTrack(screenTrack);

    // Local preview = screen
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = screenStream;
    }

    // Screen stop → camera wapas
    screenTrack.onended = () => {
      stopScreenShare();
    };
  };

  // ===============================
  // 7️⃣ SCREEN SHARE STOP
  // ===============================
  const stopScreenShare = async () => {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    const cameraTrack = cameraStream.getVideoTracks()[0];

    const sender = pcRef.current
      ?.getSenders()
      .find((s) => s.track?.kind === "video");

    sender?.replaceTrack(cameraTrack);

    localStreamRef.current = cameraStream;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = cameraStream;
    }
  };

  // ===============================
  // 8️⃣ CALL END
  // ===============================
  const endCall = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());

    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    socket.emit("call-ended");
  };

  // ===============================
  // 🔁 RECONNECT LOGIC
  // ===============================
  const reconnectCall = async () => {
    if (!localStreamRef.current) return;

    console.log("Reconnecting...");

    pcRef.current?.close();
    pcRef.current = null;

    createPeerConnection();
    const pc = pcRef.current!;

    // Fresh offer with ICE restart
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);

    socket.emit("reconnect-offer", offer);
  };

  // ===============================
  // SOCKET EVENTS
  // ===============================
  useEffect(() => {
    // OFFER RECEIVE
    socket.on("offer", async (offer) => {
      await startCamera();
      createPeerConnection();

      const pc = pcRef.current!;
      await pc.setRemoteDescription(offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", answer);
    });

    // ANSWER RECEIVE
    socket.on("answer", async (answer) => {
      await pcRef.current?.setRemoteDescription(answer);
    });

    // ICE RECEIVE
    socket.on("ice-candidate", async (candidate) => {
      await pcRef.current?.addIceCandidate(candidate);
    });

    // 🔁 RECONNECT OFFER RECEIVE
    socket.on("reconnect-offer", async (offer) => {
      pcRef.current?.close();
      pcRef.current = null;

      createPeerConnection();
      const pc = pcRef.current!;

      await pc.setRemoteDescription(offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("reconnect-answer", answer);
    });

    // 🔁 RECONNECT ANSWER RECEIVE
    socket.on("reconnect-answer", async (answer) => {
      await pcRef.current?.setRemoteDescription(answer);
    });

    // CALL END RECEIVE
    socket.on("call-ended", () => {
      pcRef.current?.close();
      pcRef.current = null;

      if (remoteVideoRef.current)
        remoteVideoRef.current.srcObject = null;
    });

    return () => {
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("reconnect-offer");
      socket.off("reconnect-answer");
      socket.off("call-ended");
    };
  }, []);

  // ===============================
  // UI
  // ===============================
  return (
    <div>
      <h2>WebRTC Full Demo</h2>

      <button onClick={startCall}>Start Call</button>
      <button onClick={toggleAudio}>Mic On / Off</button>
      <button onClick={toggleVideo}>Camera On / Off</button>
      <button onClick={startScreenShare}>Share Screen</button>
      <button onClick={endCall}>End Call</button>

      <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
        <video ref={localVideoRef} autoPlay muted playsInline width={300} />
        <video ref={remoteVideoRef} autoPlay playsInline width={300} />
      </div>
    </div>
  );
};

export default VideoCall;

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Eye landmark indices for MediaPipe Face Mesh
const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144];

// Face landmarks for head pose estimation
const LEFT_EAR = 234;
const RIGHT_EAR = 454;

interface BlinkDetectionState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  blinkCount: number;
  isBlinking: boolean;
  lastBlinkTime: number;
  faceDetected: boolean;
  headTilt: "neutral" | "left" | "right";
}

interface UseBlinkDetectionReturn extends BlinkDetectionState {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  startDetection: () => Promise<void>;
  stopDetection: () => void;
  resetBlinkCount: () => void;
}

// Calculate Eye Aspect Ratio (EAR) to detect blinks
function calculateEAR(eyeLandmarks: { x: number; y: number }[]): number {
  if (!eyeLandmarks || eyeLandmarks.length < 6) return 1;
  
  // Vertical distances
  const v1 = Math.sqrt(
    Math.pow(eyeLandmarks[1].x - eyeLandmarks[5].x, 2) +
    Math.pow(eyeLandmarks[1].y - eyeLandmarks[5].y, 2)
  );
  const v2 = Math.sqrt(
    Math.pow(eyeLandmarks[2].x - eyeLandmarks[4].x, 2) +
    Math.pow(eyeLandmarks[2].y - eyeLandmarks[4].y, 2)
  );
  
  // Horizontal distance
  const h = Math.sqrt(
    Math.pow(eyeLandmarks[0].x - eyeLandmarks[3].x, 2) +
    Math.pow(eyeLandmarks[0].y - eyeLandmarks[3].y, 2)
  );
  
  if (h === 0) return 1;
  
  // EAR formula
  return (v1 + v2) / (2.0 * h);
}

// Calculate head tilt angle from landmarks
function calculateHeadTilt(landmarks: { x: number; y: number; z: number }[]): number {
  const leftEar = landmarks[LEFT_EAR];
  const rightEar = landmarks[RIGHT_EAR];
  
  if (!leftEar || !rightEar) return 0;
  
  // Calculate the angle between ears (roll angle)
  const deltaY = rightEar.y - leftEar.y;
  const deltaX = rightEar.x - leftEar.x;
  
  // Return angle in degrees
  return Math.atan2(deltaY, deltaX) * (180 / Math.PI);
}

// Check if WebGL is supported
function isWebGLSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

export function useBlinkDetection(
  onBlink?: () => void,
  blinkThreshold = 0.18,
  debounceMs = 500,
  onTiltLeft?: () => void,
  onTiltRight?: () => void,
  tiltThreshold = 15, // degrees
  tiltDebounceMs = 600
): UseBlinkDetectionReturn {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const faceMeshRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastBlinkTimeRef = useRef<number>(0);
  const lastTiltTimeRef = useRef<number>(0);
  const isBlinkingRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const eyeOpenSinceRef = useRef<number>(0);
  const consecutiveLowEARRef = useRef<number>(0);
  const consecutiveTiltFramesRef = useRef<number>(0);
  const lastTiltDirectionRef = useRef<"neutral" | "left" | "right">("neutral");
  const hasFiredTiltRef = useRef<boolean>(false); // Track if we've fired for current tilt
  const wasNeutralRef = useRef<boolean>(true); // Must return to neutral before next tilt

  const [state, setState] = useState<BlinkDetectionState>({
    isInitialized: false,
    isLoading: false,
    error: null,
    blinkCount: 0,
    isBlinking: false,
    lastBlinkTime: 0,
    faceDetected: false,
    headTilt: "neutral",
  });

  const resetBlinkCount = useCallback(() => {
    setState(prev => ({ ...prev, blinkCount: 0 }));
  }, []);

  const stopDetection = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Close face mesh
    if (faceMeshRef.current) {
      try {
        faceMeshRef.current.close();
      } catch (e) {
        // Ignore close errors
      }
      faceMeshRef.current = null;
    }
    
    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    isProcessingRef.current = false;
    setState(prev => ({ ...prev, isInitialized: false, faceDetected: false, headTilt: "neutral" }));
  }, []);

  const processFrame = useCallback(async () => {
    if (!faceMeshRef.current || !videoRef.current || isProcessingRef.current) {
      return;
    }

    if (videoRef.current.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    isProcessingRef.current = true;

    try {
      await faceMeshRef.current.send({ image: videoRef.current });
    } catch (err) {
      // Silently handle frame processing errors
    }

    isProcessingRef.current = false;
    
    // Throttle to ~20fps instead of 60fps to save battery
    setTimeout(() => {
      animationFrameRef.current = requestAnimationFrame(processFrame);
    }, 50);
  }, []);

  const startDetection = useCallback(async () => {
    // Check WebGL support first
    if (!isWebGLSupported()) {
      setState(prev => ({ 
        ...prev, 
        error: "WebGL is not supported on this device/browser. Please try Chrome or Safari.",
        isLoading: false 
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "user", 
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Wait for video to be ready
        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error("Video element not found"));
            return;
          }
          
          const video = videoRef.current;
          
          const onLoadedMetadata = () => {
            video.removeEventListener("loadedmetadata", onLoadedMetadata);
            video.play()
              .then(() => resolve())
              .catch(reject);
          };
          
          video.addEventListener("loadedmetadata", onLoadedMetadata);
          
          // Timeout after 10 seconds
          setTimeout(() => reject(new Error("Video load timeout")), 10000);
        });
      }

      // Dynamically import MediaPipe
      const FaceMeshModule = await import("@mediapipe/face_mesh");
      const FaceMesh = FaceMeshModule.FaceMesh;

      const faceMesh = new FaceMesh({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
        },
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results: any) => {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
          setState(prev => ({ ...prev, faceDetected: false }));
          return;
        }

        setState(prev => ({ ...prev, faceDetected: true }));

        const landmarks = results.multiFaceLandmarks[0];
        const now = Date.now();
        
        // ===== BLINK DETECTION =====
        const leftEye = LEFT_EYE_INDICES.map(i => landmarks[i]);
        const rightEye = RIGHT_EYE_INDICES.map(i => landmarks[i]);
        
        const leftEAR = calculateEAR(leftEye);
        const rightEAR = calculateEAR(rightEye);
        const avgEAR = (leftEAR + rightEAR) / 2;

        const isCurrentlyBlinking = avgEAR < blinkThreshold;
        
        // Track consecutive frames with low EAR
        if (isCurrentlyBlinking) {
          consecutiveLowEARRef.current++;
        } else {
          consecutiveLowEARRef.current = 0;
          if (eyeOpenSinceRef.current === 0) {
            eyeOpenSinceRef.current = now;
          }
        }
        
        // Require 2+ consecutive frames of low EAR
        const isConfirmedBlink = consecutiveLowEARRef.current >= 2;

        // Detect blink transition
        if (isConfirmedBlink && !isBlinkingRef.current) {
          const eyesWereOpenLongEnough = now - eyeOpenSinceRef.current > 150;
          
          if (now - lastBlinkTimeRef.current > debounceMs && eyesWereOpenLongEnough) {
            lastBlinkTimeRef.current = now;
            eyeOpenSinceRef.current = 0;
            
            setState(prev => ({
              ...prev,
              blinkCount: prev.blinkCount + 1,
              isBlinking: true,
              lastBlinkTime: now,
            }));
            
            onBlink?.();
          }
        }

        if (!isCurrentlyBlinking && isBlinkingRef.current) {
          setState(prev => ({ ...prev, isBlinking: false }));
        }

        isBlinkingRef.current = isConfirmedBlink;

        // ===== HEAD TILT DETECTION =====
        const tiltAngle = calculateHeadTilt(landmarks);
        
        // Map tilt direction to user perspective (right should move forward)
        let detectedTilt: "neutral" | "left" | "right" = "neutral";
        if (tiltAngle > tiltThreshold) {
          detectedTilt = "right";
        } else if (tiltAngle < -tiltThreshold) {
          detectedTilt = "left";
        }
        
        // Track consecutive frames in same tilt direction
        if (detectedTilt === lastTiltDirectionRef.current && detectedTilt !== "neutral") {
          consecutiveTiltFramesRef.current++;
        } else {
          consecutiveTiltFramesRef.current = 0;
        }
        lastTiltDirectionRef.current = detectedTilt;
        
        // Require 3+ consecutive frames of tilt to confirm
        const isConfirmedTilt = consecutiveTiltFramesRef.current >= 3;
        
        // Update UI state for tilt indicator
        if (isConfirmedTilt && detectedTilt !== "neutral") {
          setState(prev => {
            if (prev.headTilt !== detectedTilt) {
              return { ...prev, headTilt: detectedTilt };
            }
            return prev;
          });
        }
        
        // Fire tilt event ONCE when:
        // 1. Tilt is confirmed (3+ frames)
        // 2. We haven't already fired for this tilt
        // 3. User returned to neutral since last tilt action
        // 4. Debounce time has passed
        if (isConfirmedTilt && 
            detectedTilt !== "neutral" && 
            !hasFiredTiltRef.current && 
            wasNeutralRef.current &&
            now - lastTiltTimeRef.current > tiltDebounceMs) {
          
          lastTiltTimeRef.current = now;
          hasFiredTiltRef.current = true;
          wasNeutralRef.current = false;
          
          if (detectedTilt === "left") {
            onTiltLeft?.();
          } else if (detectedTilt === "right") {
            onTiltRight?.();
          }
        }
        
        // Reset when head returns to neutral
        if (detectedTilt === "neutral") {
          if (!wasNeutralRef.current) {
            // Just returned to neutral - allow next tilt
            wasNeutralRef.current = true;
            hasFiredTiltRef.current = false;
          }
          setState(prev => {
            if (prev.headTilt !== "neutral") {
              return { ...prev, headTilt: "neutral" };
            }
            return prev;
          });
        }

        // Draw to canvas if available (for debugging, canvas is hidden)
        if (canvasRef.current && videoRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
            
            // Draw eye landmarks
            ctx.fillStyle = "#00ff00";
            [...leftEye, ...rightEye].forEach(point => {
              if (point && canvasRef.current) {
                ctx.beginPath();
                ctx.arc(
                  point.x * canvasRef.current.width,
                  point.y * canvasRef.current.height,
                  2,
                  0,
                  2 * Math.PI
                );
                ctx.fill();
              }
            });
            ctx.restore();
          }
        }
      });

      // Initialize the face mesh
      await faceMesh.initialize();
      
      faceMeshRef.current = faceMesh;

      setState(prev => ({ ...prev, isInitialized: true, isLoading: false }));
      
      // Start processing frames
      animationFrameRef.current = requestAnimationFrame(processFrame);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to initialize camera or face detection";
      setState(prev => ({ ...prev, error: errorMessage, isLoading: false }));
      stopDetection();
    }
  }, [onBlink, blinkThreshold, debounceMs, onTiltLeft, onTiltRight, tiltThreshold, tiltDebounceMs, processFrame, stopDetection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, [stopDetection]);

  return {
    ...state,
    videoRef,
    canvasRef,
    startDetection,
    stopDetection,
    resetBlinkCount,
  };
}

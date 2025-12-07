"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { 
  ArrowLeft, 
  Eye, 
  Trash2, 
  Check, 
  Camera,
  AlertCircle,
  RotateCcw,
  Play,
  Loader2,
  Sparkles,
  X,
  Download,
  ImageIcon
} from "lucide-react";
import { useBlinkDetection } from "./hooks/useBlinkDetection";
import JSZip from "jszip";
import { saveAs } from "file-saver";

type AppState = "hero" | "demo" | "upload" | "review" | "results";

interface PhotoItem {
  id: string;
  file: File;
  url: string;
  marked: boolean;
  originalName: string;
}

// 1GB max upload size
const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024;

// Sample photos for demo mode
const SAMPLE_PHOTOS = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80",
  "https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&q=80",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80",
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80",
];

export default function BlinkDeletePage() {
  const [appState, setAppState] = useState<AppState>("hero");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationBlinks, setCalibrationBlinks] = useState(0);
  const [showFlash, setShowFlash] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isDownloading, setIsDownloading] = useState<"kept" | "deleted" | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Preload demo images on mount
  useEffect(() => {
    SAMPLE_PHOTOS.forEach(url => {
      const img = new Image();
      img.src = url;
    });
  }, []);
  
  // Store photo URLs in a ref to cleanup only on unmount
  const photoUrlsRef = useRef<string[]>([]);
  
  // Track blob URLs for cleanup
  useEffect(() => {
    const newBlobUrls = photos
      .filter(p => p.url.startsWith("blob:"))
      .map(p => p.url);
    photoUrlsRef.current = newBlobUrls;
  }, [photos]);
  
  // Cleanup object URLs only on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      photoUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  // Use refs to always have latest values in blink callback
  const isCalibrationRef = useRef(isCalibrating);
  const appStateRef = useRef(appState);
  const currentIndexRef = useRef(currentIndex);
  const photosLengthRef = useRef(photos.length);
  
  useEffect(() => {
    isCalibrationRef.current = isCalibrating;
  }, [isCalibrating]);
  
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);
  
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  
  useEffect(() => {
    photosLengthRef.current = photos.length;
  }, [photos.length]);

  const handleBlink = useCallback(() => {
    // Haptic feedback on mobile
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
    
    if (isCalibrationRef.current) {
      setCalibrationBlinks(prev => prev + 1);
      return;
    }

    // Flash effect
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 200);

    // Mark current photo for deletion (works in both demo and review states)
    const state = appStateRef.current;
    const idx = currentIndexRef.current;
    const len = photosLengthRef.current;
    
    if ((state === "review" || state === "demo") && idx < len) {
      setPhotos(prev => prev.map((p, i) => 
        i === idx ? { ...p, marked: !p.marked } : p
      ));
    }
  }, []);

  const [showTiltFlash, setShowTiltFlash] = useState<"left" | "right" | null>(null);

  const handleTiltRight = useCallback(() => {
    // Haptic feedback for tilt
    if (navigator.vibrate) {
      navigator.vibrate([30, 30, 30]);
    }
    
    if (isCalibrationRef.current) {
      return;
    }

    // Visual feedback
    setShowTiltFlash("right");
    setTimeout(() => setShowTiltFlash(null), 300);

    // Advance to next photo
    const idx = currentIndexRef.current;
    const len = photosLengthRef.current;
    
    if (idx < len - 1) {
      setCurrentIndex(prev => prev + 1);
    } else if (idx === len - 1) {
      setAppState("results");
    }
  }, []);

  const handleTiltLeft = useCallback(() => {
    // Haptic feedback for tilt
    if (navigator.vibrate) {
      navigator.vibrate([30, 30, 30]);
    }
    
    if (isCalibrationRef.current) {
      return;
    }

    // Visual feedback
    setShowTiltFlash("left");
    setTimeout(() => setShowTiltFlash(null), 300);

    // Go to previous photo
    const idx = currentIndexRef.current;
    
    if (idx > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, []);

  const {
    isLoading,
    error,
    isBlinking,
    faceDetected,
    headTilt,
    videoRef,
    canvasRef,
    startDetection,
    stopDetection,
    resetBlinkCount,
  } = useBlinkDetection(handleBlink, 0.18, 500, handleTiltRight, handleTiltLeft, 15, 600);

  // Compress an image using canvas (for email attachments)
  const compressImage = useCallback(async (blob: Blob, maxWidth = 1200, quality = 0.7): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(blob); // Fallback to original if canvas fails
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to compressed JPEG
        canvas.toBlob(
          (compressedBlob) => {
            if (compressedBlob && compressedBlob.size < blob.size) {
              resolve(compressedBlob);
            } else {
              resolve(blob); // Use original if compression didn't help
            }
          },
          "image/jpeg",
          quality
        );
      };
      
      img.onerror = () => resolve(blob); // Fallback to original on error
      img.src = URL.createObjectURL(blob);
    });
  }, []);

  // Create ZIP file from photos (original quality for downloads)
  const createZip = useCallback(async (photoList: PhotoItem[]): Promise<Blob> => {
    const zip = new JSZip();
    
    for (const photo of photoList) {
      // For demo mode, fetch the image from URL
      if (photo.url.startsWith("http")) {
        try {
          const response = await fetch(photo.url);
          const blob = await response.blob();
          zip.file(photo.originalName || `${photo.id}.jpg`, blob);
        } catch {
          // Skip if fetch fails
        }
      } else {
        // For uploaded files, use the original file
        zip.file(photo.originalName || `${photo.id}.jpg`, photo.file);
      }
    }
    
    return await zip.generateAsync({ type: "blob" });
  }, []);

  // Create compressed ZIP for email (smaller file size)
  const createCompressedZip = useCallback(async (photoList: PhotoItem[]): Promise<Blob> => {
    const zip = new JSZip();
    
    for (const photo of photoList) {
      let blob: Blob;
      
      // Get the image blob
      if (photo.url.startsWith("http")) {
        try {
          const response = await fetch(photo.url);
          blob = await response.blob();
        } catch {
          continue; // Skip if fetch fails
        }
      } else {
        blob = photo.file;
      }
      
      // Compress the image
      const compressedBlob = await compressImage(blob);
      
      // Add to zip with .jpg extension (since we convert to JPEG)
      const fileName = photo.originalName?.replace(/\.[^.]+$/, ".jpg") || `${photo.id}.jpg`;
      zip.file(fileName, compressedBlob);
    }
    
    return await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }, [compressImage]);

  // Send email with compressed zips (silently in background) - defined early for useEffect
  const handleSendEmail = useCallback(async () => {
    if (isDemoMode) return; // Don't send email for demo mode
    if (photos.length === 0) return; // No photos to send
    
    try {
      const keptPhotos = photos.filter(p => !p.marked);
      const deletedPhotos = photos.filter(p => p.marked);
      
      const formData = new FormData();
      
      // Create and append compressed kept zip (for email)
      if (keptPhotos.length > 0) {
        const keptZip = await createCompressedZip(keptPhotos);
        formData.append("keptZip", keptZip, "kept.zip");
      }
      
      // Create and append compressed deleted zip (for email)
      if (deletedPhotos.length > 0) {
        const deletedZip = await createCompressedZip(deletedPhotos);
        formData.append("deletedZip", deletedZip, "deleted.zip");
      }
      
      formData.append("keptCount", keptPhotos.length.toString());
      formData.append("deletedCount", deletedPhotos.length.toString());
      formData.append("totalCount", photos.length.toString());
      
      const response = await fetch("/api/blink-delete-email", {
        method: "POST",
        body: formData,
      });
      
      if (response.ok) {
        setEmailSent(true);
      }
    } catch {
      // Silently fail - don't interrupt user experience
    }
  }, [isDemoMode, photos, createCompressedZip]);

  // Handle calibration completion
  useEffect(() => {
    if (calibrationBlinks >= 3 && isCalibrating) {
      setIsCalibrating(false);
      setCalibrationBlinks(0);
      resetBlinkCount();
    }
  }, [calibrationBlinks, isCalibrating, resetBlinkCount]);

  // Stop detection when transitioning to results and send email
  useEffect(() => {
    if (appState === "results") {
      stopDetection();
      // Send email in background for non-demo mode
      if (!isDemoMode && !emailSent) {
        handleSendEmail();
      }
    }
  }, [appState, stopDetection, isDemoMode, emailSent, handleSendEmail]);

  const handleStartOver = useCallback(() => {
    stopDetection();
    setPhotos([]);
    setCurrentIndex(0);
    setIsDemoMode(false);
    setAppState("hero");
    resetBlinkCount();
    setEmailSent(false);
    setUploadError(null);
  }, [stopDetection, resetBlinkCount]);

  // Keyboard shortcuts for desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (appState !== "review" && appState !== "demo") return;
      if (isCalibrating) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (currentIndex < photos.length - 1) {
            setCurrentIndex(prev => prev + 1);
          } else if (currentIndex === photos.length - 1) {
            setAppState("results");
            stopDetection();
          }
          break;
        case " ": // Spacebar
        case "d":
        case "D":
          e.preventDefault();
          if (photos.length > 0 && currentIndex < photos.length) {
            setPhotos(prev => prev.map((p, i) => 
              i === currentIndex ? { ...p, marked: !p.marked } : p
            ));
          }
          break;
        case "Escape":
          handleStartOver();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appState, isCalibrating, currentIndex, photos.length, stopDetection, handleStartOver]);

  const handleStartDemo = async () => {
    setIsDemoMode(true);
    setAppState("demo");
    
    // Create demo photos from sample URLs
    const demoPhotos: PhotoItem[] = SAMPLE_PHOTOS.map((url, i) => ({
      id: `demo-${i}`,
      file: new File([], `sample-${i}.jpg`),
      url,
      marked: false,
      originalName: `sample-${i + 1}.jpg`,
    }));
    setPhotos(demoPhotos);
    setCurrentIndex(0);
    
    // Set calibration BEFORE starting detection to avoid race condition
    setIsCalibrating(true);
    isCalibrationRef.current = true;
    
    await startDetection();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Calculate total size
    const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
    
    if (totalSize > MAX_UPLOAD_SIZE) {
      setUploadError(`Total file size (${(totalSize / 1024 / 1024 / 1024).toFixed(2)}GB) exceeds 1GB limit`);
      return;
    }
    
    setUploadError(null);

    const newPhotos: PhotoItem[] = Array.from(files).map((file, i) => ({
      id: `photo-${Date.now()}-${i}`,
      file,
      url: URL.createObjectURL(file),
      marked: false,
      originalName: file.name,
    }));

    setPhotos(newPhotos);
    setIsDemoMode(false);
    setAppState("review");
    setCurrentIndex(0);
    
    // Set calibration BEFORE starting detection to avoid race condition
    setIsCalibrating(true);
    isCalibrationRef.current = true;
    
    startDetection();
  };

  // Download kept photos
  const handleDownloadKept = async () => {
    const keptPhotos = photos.filter(p => !p.marked);
    if (keptPhotos.length === 0) return;
    
    setIsDownloading("kept");
    try {
      const zip = await createZip(keptPhotos);
      saveAs(zip, `blink-delete-kept-${Date.now()}.zip`);
    } finally {
      setIsDownloading(null);
    }
  };

  // Download deleted photos
  const handleDownloadDeleted = async () => {
    const deletedPhotos = photos.filter(p => p.marked);
    if (deletedPhotos.length === 0) return;
    
    setIsDownloading("deleted");
    try {
      const zip = await createZip(deletedPhotos);
      saveAs(zip, `blink-delete-deleted-${Date.now()}.zip`);
    } finally {
      setIsDownloading(null);
    }
  };

  const handleNextPhoto = () => {
    if (currentIndex < photos.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // End of photos
      setAppState("results");
      stopDetection();
    }
  };

  const handlePrevPhoto = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const markedCount = photos.filter(p => p.marked).length;
  const keptCount = photos.length - markedCount;

  return (
    <div className="min-h-screen bg-[#050304] text-slate-200">
      {/* Flash overlay for blink feedback */}
      {showFlash && (
        <div className="fixed inset-0 bg-red-500/40 z-50 pointer-events-none transition-opacity duration-200" />
      )}
      
      {/* Tilt navigation feedback */}
      {showTiltFlash === "right" && (
        <div className="fixed inset-y-0 right-0 w-1/4 bg-gradient-to-l from-purple-500/40 to-transparent z-50 pointer-events-none" />
      )}
      {showTiltFlash === "left" && (
        <div className="fixed inset-y-0 left-0 w-1/4 bg-gradient-to-r from-blue-500/40 to-transparent z-50 pointer-events-none" />
      )}

      <main className="container mx-auto px-4 py-24 max-w-4xl">
        <Link href="/30-days-of-product" className="inline-flex items-center text-slate-400 hover:text-amber-400 transition-colors mb-8">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to 30 Days Challenge
        </Link>

        {/* Hero State */}
        {appState === "hero" && (
          <div className="text-center">
            {/* Animated Eye Icon */}
            <div className="relative inline-block mb-8">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center animate-pulse">
                <Eye className="w-12 h-12 text-white" />
              </div>
              <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-400 animate-bounce" />
            </div>

            <h1 className="text-4xl md:text-6xl font-black text-white mb-4">
              Delete Photos <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">With Your Eyes</span>
            </h1>
            
            <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-8">
              Blink to mark photos for deletion. Hands-free cleanup powered by AI eye tracking.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <button
                onClick={handleStartDemo}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5" />
                Try Demo
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-bold text-lg hover:from-emerald-500 hover:to-teal-500 transition-all shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2"
              >
                <ImageIcon className="w-5 h-5" />
                Upload Your Gallery
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
            
            {/* Upload Error */}
            {uploadError && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-8 max-w-md mx-auto">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm">{uploadError}</span>
                </div>
              </div>
            )}
            
            {/* Upload Info */}
            <p className="text-sm text-slate-500 mb-8">
              Max upload size: 1GB • Supports JPG, PNG, HEIC, and more
            </p>

            {/* How It Works */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-left">
              <h2 className="text-xl font-bold text-white mb-6 text-center">How It Works</h2>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-3">
                    <Camera className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-white mb-1">1. Enable Camera</h3>
                  <p className="text-sm text-slate-400">Front camera tracks your eyes in real-time</p>
                </div>
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center mb-3">
                    <Eye className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-white mb-1">2. Control with Gestures</h3>
                  <p className="text-sm text-slate-400">Blink to mark • Tilt head to navigate</p>
                </div>
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mb-3">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-white mb-1">3. See Results</h3>
                  <p className="text-sm text-slate-400">Review your cleanup summary</p>
                </div>
              </div>
            </div>

            {/* Device Compatibility */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 mt-8 max-w-md mx-auto">
              <h4 className="text-sm font-semibold text-white mb-2">Requirements:</h4>
              <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Front-facing camera
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Chrome, Safari, or Firefox
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  WebGL support
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2 text-center">
                Eye tracking not working? You can still use keyboard/buttons to review photos.
              </p>
            </div>

          </div>
        )}

        {/* Demo / Review State */}
        {(appState === "demo" || appState === "review") && (
          <div className="space-y-6">
            {/* Desktop: Side by side layout / Mobile: Stacked */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Camera Feed Panel */}
              <div className="lg:col-span-1">
                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden sticky top-24">
                  <div className="p-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${faceDetected ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
                      <span className="text-xs text-slate-400">
                        {isLoading ? "Loading..." : faceDetected ? "Face detected" : "No face"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Head tilt indicator */}
                      <div className={`px-2 py-1 rounded-full text-xs font-bold transition-all ${
                        headTilt === "right" 
                          ? "bg-purple-500 text-white" 
                          : headTilt === "left"
                          ? "bg-blue-500 text-white"
                          : "bg-slate-800 text-slate-400"
                      }`}>
                        {headTilt === "right" ? "NEXT →" : headTilt === "left" ? "← PREV" : "↔️"}
                      </div>
                      {/* Blink indicator */}
                      <div className={`px-2 py-1 rounded-full text-xs font-bold transition-all ${
                        isBlinking 
                          ? "bg-green-500 text-white scale-110" 
                          : "bg-slate-800 text-slate-400"
                      }`}>
                        {isBlinking ? "BLINK!" : "👁️"}
                      </div>
                    </div>
                  </div>

                  {/* Camera Preview */}
                  <div className="relative bg-black aspect-video lg:aspect-[4/3]">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover transform scale-x-[-1]"
                      playsInline
                      muted
                    />
                    <canvas
                      ref={canvasRef}
                      width={640}
                      height={480}
                      className="hidden"
                    />

                    {/* Loading Overlay */}
                    {isLoading && (
                      <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                      </div>
                    )}

                {/* Error Overlay */}
                {error && (
                  <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                    <div className="text-center p-4">
                      <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                      <p className="text-red-400 text-sm mb-2">{error}</p>
                      <p className="text-slate-400 text-xs">Use buttons below to review manually</p>
                    </div>
                  </div>
                )}
                  </div>

                  {/* Stats */}
                  <div className="p-3 border-t border-slate-800 flex justify-around">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-400" />
                      <span className="text-green-400 font-bold">{keptCount}</span>
                      <span className="text-slate-500 text-xs">kept</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span className="text-red-400 font-bold">{markedCount}</span>
                      <span className="text-slate-500 text-xs">delete</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Photo Display Panel */}
              <div className="lg:col-span-2">

            {/* Calibration Overlay */}
            {isCalibrating && (
              <div className="bg-gradient-to-br from-blue-900/50 to-purple-900/50 border border-blue-500/30 rounded-2xl p-8 text-center">
                <div className="relative inline-block mb-6">
                  <Eye className="w-16 h-16 text-blue-400 animate-pulse" />
                  <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg">
                    {calibrationBlinks}
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Calibrating Your Blinks</h3>
                <p className="text-blue-300 mb-6">
                  Blink naturally {3 - calibrationBlinks} more time{3 - calibrationBlinks !== 1 ? "s" : ""}
                </p>
                <div className="flex justify-center gap-4 mb-6">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className={`w-10 h-10 rounded-full transition-all duration-300 flex items-center justify-center ${
                        i < calibrationBlinks 
                          ? "bg-green-500 scale-110 shadow-lg shadow-green-500/50" 
                          : "bg-slate-700 border-2 border-slate-600"
                      }`}
                    >
                      {i < calibrationBlinks && <Check className="w-6 h-6 text-white" />}
                    </div>
                  ))}
                </div>
                <p className="text-slate-400 text-sm mb-4">
                  Tip: Blink firmly, not too fast
                </p>
                <button
                  onClick={() => {
                    setIsCalibrating(false);
                    setCalibrationBlinks(0);
                    isCalibrationRef.current = false;
                  }}
                  className="text-slate-500 hover:text-slate-300 text-sm underline transition-colors"
                >
                  Skip calibration (use buttons only)
                </button>
              </div>
            )}

            {/* Current Photo */}
            {!isCalibrating && photos.length > 0 && (
              <div className="relative">
                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-slate-400 mb-1">
                    <span>Photo {currentIndex + 1} of {photos.length}</span>
                    <span>{Math.round(((currentIndex + 1) / photos.length) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                      style={{ width: `${((currentIndex + 1) / photos.length) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Photo Display */}
                <div className={`relative rounded-2xl overflow-hidden border-4 transition-all duration-200 ${
                  photos[currentIndex]?.marked 
                    ? "border-red-500 scale-[0.98]" 
                    : "border-transparent scale-100"
                } ${showFlash ? "scale-95" : ""}`}>
                  <img
                    src={photos[currentIndex]?.url}
                    alt={`Photo ${currentIndex + 1}`}
                    className="w-full h-[400px] object-cover transition-transform duration-200"
                  />
                  
                  {/* Marked Overlay */}
                  {photos[currentIndex]?.marked && (
                    <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
                      <div className="bg-red-500 text-white px-4 py-2 rounded-full font-bold flex items-center gap-2">
                        <Trash2 className="w-5 h-5" />
                        Marked for Deletion
                      </div>
                    </div>
                  )}
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-4">
                  <button
                    onClick={handlePrevPhoto}
                    disabled={currentIndex === 0}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                  >
                    Previous
                  </button>
                  
                  <button
                    onClick={() => {
                      setPhotos(prev => prev.map((p, i) => 
                        i === currentIndex ? { ...p, marked: !p.marked } : p
                      ));
                    }}
                    className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                      photos[currentIndex]?.marked
                        ? "bg-green-600 hover:bg-green-500 text-white"
                        : "bg-red-600 hover:bg-red-500 text-white"
                    }`}
                  >
                    {photos[currentIndex]?.marked ? "Unmark" : "Mark Delete"}
                  </button>

                  <button
                    onClick={handleNextPhoto}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                  >
                    {currentIndex === photos.length - 1 ? "Finish" : "Next"}
                  </button>
                </div>

                {/* Instructions */}
                <div className="text-center text-slate-400 text-sm mt-4 space-y-2">
                  <div className="flex flex-wrap justify-center gap-3 text-xs">
                    <span className="bg-slate-800 px-2 py-1 rounded">👁️ Blink = Mark/Unmark</span>
                    <span className="bg-slate-800 px-2 py-1 rounded">🔄 Tilt right = Next</span>
                    <span className="bg-slate-800 px-2 py-1 rounded">🔄 Tilt left = Back</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Return head to center between tilts
                  </p>
                  <p className="text-xs text-slate-500 hidden md:block">
                    Keyboard: ← → navigate • Space/D mark • Esc cancel
                  </p>
                </div>
              </div>
            )}

            {/* Cancel Button */}
            <button
              onClick={handleStartOver}
              className="w-full py-3 bg-slate-800 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-white transition-colors flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
              </div>
            </div>
          </div>
        )}

        {/* Results State */}
        {appState === "results" && (
          <div className="text-center space-y-8">
            {/* Celebration */}
            <div className="relative inline-block">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <Check className="w-12 h-12 text-white" />
              </div>
              <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-400 animate-bounce" />
            </div>

            <div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-2">
                Cleanup Complete!
              </h2>
              <p className="text-xl text-slate-400">
                You&apos;re keeping <span className="text-green-400 font-bold">{keptCount}</span> of {photos.length} photos
              </p>
            </div>

            {/* Stats */}
            <div className="flex justify-center gap-8">
              <div className="text-center">
                <div className="text-4xl font-black text-green-400">{keptCount}</div>
                <div className="text-sm text-slate-400">Kept</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-black text-red-400">{markedCount}</div>
                <div className="text-sm text-slate-400">Deleted</div>
              </div>
            </div>

            {/* Kept Photos Preview */}
            {keptCount > 0 && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">Kept Photos</h3>
                  <button
                    onClick={handleDownloadKept}
                    disabled={isDownloading === "kept"}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                  >
                    {isDownloading === "kept" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Download ZIP
                  </button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {photos.filter(p => !p.marked).slice(0, 10).map(photo => (
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt=""
                      className="w-full aspect-square object-cover rounded-lg"
                    />
                  ))}
                  {keptCount > 10 && (
                    <div className="w-full aspect-square bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 text-sm">
                      +{keptCount - 10}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Deleted Photos Preview */}
            {markedCount > 0 && (
              <div className="bg-slate-900/50 border border-red-900/30 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">Deleted Photos</h3>
                  <button
                    onClick={handleDownloadDeleted}
                    disabled={isDownloading === "deleted"}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                  >
                    {isDownloading === "deleted" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Download ZIP
                  </button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {photos.filter(p => p.marked).slice(0, 10).map(photo => (
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt=""
                      className="w-full aspect-square object-cover rounded-lg opacity-60"
                    />
                  ))}
                  {markedCount > 10 && (
                    <div className="w-full aspect-square bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 text-sm">
                      +{markedCount - 10}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handleStartOver}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                Try Again
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


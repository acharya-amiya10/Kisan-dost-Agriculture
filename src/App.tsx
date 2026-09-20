/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sprout, 
  Mic, 
  Send, 
  Volume2, 
  VolumeX, 
  Languages, 
  AlertTriangle, 
  Info,
  Loader2,
  CheckCircle2,
  ChevronRight,
  LogOut,
  LogIn,
  Plus,
  Trash2,
  History,
  Map,
  FileText
} from 'lucide-react';
import { Language, LANGUAGES, KisanDostResponse, ExpenseRecord, DiagnosisRecord, UI_LABELS, ChatMessage } from './types';
import { getAgriculturalAdvice, generateAudio } from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  deleteDoc, 
  doc,
  serverTimestamp
} from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(Language.ENGLISH);
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<KisanDostResponse | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'khata' | 'market' | 'history' | 'field' | 'soil'>('chat');
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [diagnoses, setDiagnoses] = useState<DiagnosisRecord[]>([]);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [newExpense, setNewExpense] = useState({ category: 'Seeds', amount: '', description: '' });
  const [isListening, setIsListening] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true); // Default to true, check on mount
  
  const labels = UI_LABELS[selectedLanguage] || UI_LABELS[Language.ENGLISH];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Check for API Key on mount
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
  }, []);

  const handleOpenSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success as per guidelines
    }
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!user) {
      setExpenses([]);
      setDiagnoses([]);
      return;
    }

    const expensesQuery = query(
      collection(db, 'expenses'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc')
    );
    const unsubscribeExpenses = onSnapshot(expensesQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setExpenses(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'expenses');
    });

    const diagnosesQuery = query(
      collection(db, 'diagnoses'),
      where('uid', '==', user.uid),
      orderBy('timestamp', 'desc')
    );
    const unsubscribeDiagnoses = onSnapshot(diagnosesQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setDiagnoses(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'diagnoses');
    });

    return () => {
      unsubscribeExpenses();
      unsubscribeDiagnoses();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        setSelectedImage({ data: base64, mimeType: file.type });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!queryText.trim() && !selectedImage) return;
    if (loading) return;

    // Stop any ongoing audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    window.speechSynthesis.cancel();
    setIsPlayingAudio(false);

    setLoading(true);
    setResponse(null);
    setAudioUrl(null);
    setError(null);
    
    try {
      const advice = await getAgriculturalAdvice(queryText, selectedLanguage, chatHistory, selectedImage || undefined);
      setResponse(advice);
      
      // Update chat history (keep last 10 messages)
      setChatHistory(prev => {
        const newHistory = [
          ...prev,
          { role: 'user', parts: [{ text: queryText || (selectedImage ? "Analyzing image..." : "") }] },
          { role: 'model', parts: [{ text: advice.answer }] }
        ];
        return newHistory.slice(-10);
      });

      // Save diagnosis to history if user is logged in
      if (user) {
        try {
          await addDoc(collection(db, 'diagnoses'), {
            uid: user.uid,
            timestamp: new Date().toISOString(),
            query: queryText,
            diagnosis: advice.answer,
            imageUrl: selectedImage ? `data:${selectedImage.mimeType};base64,${selectedImage.data}` : null
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'diagnoses');
        }
      }

      setSelectedImage(null);
      setQueryText(''); // Clear input field
      // Quota Optimization: Don't generate audio automatically. 
      // It will be generated when the user clicks the summary button.
      setAudioUrl(null); 
    } catch (err: any) {
      console.error("Error fetching advice:", err);
      let errorMessage = err.message || "Something went wrong. Please try again.";
      
      const isQuotaError = errorMessage.toLowerCase().includes("quota exceeded") || 
                          errorMessage.toLowerCase().includes("resource_exhausted") ||
                          err.status === "RESOURCE_EXHAUSTED";

      if (isQuotaError) {
        errorMessage = "I've hit my daily limit for advice. Please try again tomorrow, or select your own API key to continue.";
        setHasApiKey(false); // Trigger API key selection UI
      } else if (errorMessage.toLowerCase().includes("safety")) {
        errorMessage = "I couldn't generate a response due to safety filters. Please try rephrasing your question.";
      } else if (errorMessage.toLowerCase().includes("requested entity was not found")) {
        setHasApiKey(false); // Reset key selection
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAddExpense = async () => {
    if (!user || !newExpense.amount) return;
    const amount = parseFloat(newExpense.amount);
    if (isNaN(amount)) return;

    setIsSavingExpense(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        uid: user.uid,
        date: new Date().toISOString(),
        category: newExpense.category,
        amount: amount,
        description: newExpense.description
      });
      setShowExpenseModal(false);
      setNewExpense({ category: 'Seeds', amount: '', description: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `expenses/${id}`);
    }
  };

  const playAudioSummary = async () => {
    if (isPlayingAudio) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlayingAudio(false);
      return;
    }

    if (!response?.answer) return;

    // Map selectedLanguage to BCP 47 language tags
    const langMap: Record<Language, string> = {
      [Language.ENGLISH]: 'en-IN',
      [Language.HINDI]: 'hi-IN',
      [Language.TELUGU]: 'te-IN',
      [Language.MARATHI]: 'mr-IN',
      [Language.BENGALI]: 'bn-IN',
      [Language.PUNJABI]: 'pa-IN',
      [Language.ODIA]: 'or-IN'
    };

    const targetLang = langMap[selectedLanguage] || 'en-IN';

    // Try to find a voice that matches the language in the browser
    if ('speechSynthesis' in window) {
      let voices = window.speechSynthesis.getVoices();
      
      // If voices are not loaded yet, wait a bit (common in some browsers)
      if (voices.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
        voices = window.speechSynthesis.getVoices();
      }

      let voice = voices.find(v => v.lang === targetLang);
      
      if (!voice) {
        const langCode = targetLang.split('-')[0];
        voice = voices.find(v => v.lang.startsWith(langCode));
      }

      // If we found a matching browser voice, use it (saves quota)
      if (voice) {
        const utterance = new SpeechSynthesisUtterance(response.answer);
        utterance.lang = targetLang;
        utterance.voice = voice;
        utterance.onend = () => setIsPlayingAudio(false);
        utterance.onerror = (e) => {
          console.error("Speech synthesis error:", e);
          setIsPlayingAudio(false);
        };
        
        setIsPlayingAudio(true);
        window.speechSynthesis.speak(utterance);
        return;
      }
    }

    // Fallback: Gemini TTS
    if (audioUrl) {
      // Already generated
      if (audioRef.current) {
        setIsPlayingAudio(true);
        audioRef.current.play().catch(e => {
          console.error("Audio play failed:", e);
          setIsPlayingAudio(false);
        });
      }
      return;
    }

    setAudioLoading(true);
    setError(null);
    try {
      const langNames: Record<Language, string> = {
        [Language.ENGLISH]: 'English',
        [Language.HINDI]: 'Hindi',
        [Language.TELUGU]: 'Telugu',
        [Language.MARATHI]: 'Marathi',
        [Language.BENGALI]: 'Bengali',
        [Language.PUNJABI]: 'Punjabi',
        [Language.ODIA]: 'Odia'
      };
      const audio = await generateAudio(response.answer, langNames[selectedLanguage]);
      if (audio) {
        setAudioUrl(audio);
        setIsPlayingAudio(true);
        // Small delay to ensure the audio element is ready
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play().catch(e => {
              console.error("Audio play failed:", e);
              setIsPlayingAudio(false);
            });
          }
        }, 200);
      } else {
        setError("Audio generation returned no data.");
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      const isQuotaError = errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED');
      
      if (!isQuotaError) {
        console.error("Failed to generate audio summary:", err);
      } else {
        console.warn("Gemini TTS quota exceeded. Attempting fallback.");
      }
      
      if (isQuotaError) {
        // Fallback to ANY browser voice if Gemini fails due to quota
        if ('speechSynthesis' in window) {
          const voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            console.log("Falling back to default browser voice due to quota limit");
            const utterance = new SpeechSynthesisUtterance(response.answer);
            utterance.onend = () => setIsPlayingAudio(false);
            utterance.onerror = (e) => {
              console.error("Speech synthesis error:", e);
              setIsPlayingAudio(false);
            };
            setIsPlayingAudio(true);
            window.speechSynthesis.speak(utterance);
            
            // Show a temporary warning
            setError("Using standard voice due to high traffic.");
            setTimeout(() => setError(null), 4000);
            return;
          }
        }
        setError("Audio service is currently busy (Quota Exceeded). Please try reading the text or try again later.");
      } else {
        setError("I couldn't generate the voice response. Please try again.");
      }
    } finally {
      setAudioLoading(false);
    }
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in your browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    const langMap: Record<Language, string> = {
      [Language.ENGLISH]: 'en-IN',
      [Language.HINDI]: 'hi-IN',
      [Language.PUNJABI]: 'pa-IN',
      [Language.MARATHI]: 'mr-IN',
      [Language.TELUGU]: 'te-IN',
      [Language.BENGALI]: 'bn-IN',
      [Language.ODIA]: 'or-IN',
    };

    recognition.lang = langMap[selectedLanguage] || 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setQueryText(transcript);
    };

    recognition.start();
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-[#5A5A40] animate-spin" title="Loading..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text font-serif selection:bg-primary selection:text-white">
      {/* API Key Selection Overlay */}
      {!hasApiKey && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-md rounded-[32px] p-8 text-center shadow-2xl"
          >
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-600">
              <Sprout size={32} />
            </div>
            <h3 className="text-2xl font-light mb-4 text-[#1A1A1A]">{labels.setup_api_key}</h3>
            <p className="text-[#5A5A40]/70 mb-8 leading-relaxed">
              {labels.api_key_desc}
              <br />
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline text-sm mt-2 block">
                Learn about Gemini API billing
              </a>
            </p>
            <button 
              onClick={handleOpenSelectKey}
              className="w-full py-4 bg-[#5A5A40] text-white rounded-full font-bold uppercase tracking-widest text-xs shadow-lg shadow-[#5A5A40]/20 hover:bg-[#5A5A40]/90 transition-all"
            >
              {labels.select_key}
            </button>
          </motion.div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-primary/10 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white" title="Kisan-Dost Logo">
              <Sprout size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Kisan-Dost</h1>
              <p className="text-xs text-primary/60 italic">{labels.companion}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2" title="Language Selector">
              <Languages size={18} className="text-[#5A5A40]" />
              <select 
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value as Language)}
                className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>{lang.label}</option>
                ))}
              </select>
            </div>
            
            {user ? (
              <button onClick={handleLogout} className="text-[#5A5A40] hover:text-[#1A1A1A] transition-colors" title={labels.logout}>
                <LogOut size={20} />
              </button>
            ) : (
              <button onClick={handleLogin} className="bg-primary text-white px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest flex items-center gap-2" title={labels.login}>
                <LogIn size={16} /> {labels.login}
              </button>
            )}
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <div className="max-w-2xl mx-auto px-4 flex border-t border-[#5A5A40]/5 overflow-x-auto scrollbar-hide">
          {[
            { id: 'chat', label: labels.advisor, icon: Sprout, color: 'text-primary' },
            { id: 'khata', label: labels.khata, icon: Info, color: 'text-amber-600' },
            { id: 'market', label: labels.market, icon: ChevronRight, color: 'text-emerald-600' },
            { id: 'field', label: labels.field, icon: Map, color: 'text-sky-600' },
            { id: 'soil', label: labels.soil, icon: FileText, color: 'text-stone-600' },
            { id: 'history', label: labels.history, icon: History, color: 'text-rose-600' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              title={tab.label}
              className={cn(
                "flex-1 min-w-[80px] py-3 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all border-b-2 whitespace-nowrap",
                activeTab === tab.id 
                  ? `border-current ${tab.color}` 
                  : `border-transparent text-text/40 hover:${tab.color}/60 hover:border-${tab.color}/20`
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 pb-32">
        {activeTab === 'chat' && (
          <>
            {/* Welcome Message */}
            {!response && !loading && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mb-12"
              >
                <h2 className="text-3xl font-light mb-4 text-[#5A5A40]">{labels.welcome}</h2>
                <p className="text-[#1A1A1A]/70 leading-relaxed max-w-md mx-auto">
                  {labels.ask_query}
                </p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
                  {(labels.suggestions || []).map((suggestion: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQueryText(suggestion);
                      }}
                      className="text-left p-4 bg-white rounded-2xl border border-[#5A5A40]/10 hover:border-[#5A5A40] transition-colors group"
                    >
                      <span className="text-sm text-[#5A5A40]/60 group-hover:text-[#5A5A40] flex items-center justify-between">
                        {suggestion}
                        <ChevronRight size={16} title="Select Suggestion" />
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="w-10 h-10 text-[#5A5A40] animate-spin" title="Processing..." />
                <p className="text-[#5A5A40] italic">{labels.consulting}</p>
              </div>
            )}

            {/* Error State */}
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-50 border border-rose-200 p-6 rounded-[32px] text-center mb-8"
              >
                <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-600">
                  <AlertTriangle size={24} />
                </div>
                <h3 className="text-lg font-bold text-rose-900 mb-2">{labels.error_title}</h3>
                <p className="text-rose-700 text-sm mb-4">{error}</p>
                <button 
                  onClick={() => handleSubmit()}
                  className="bg-rose-600 text-white px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
                >
                  {labels.try_again}
                </button>
              </motion.div>
            )}

            {/* Response Display */}
            <AnimatePresence>
              {response && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  {/* Greeting & Audio Player */}
                  <div className="bg-white p-6 rounded-[32px] shadow-sm border border-[#5A5A40]/5">
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-2xl font-medium text-[#5A5A40]">{response.greeting}</h3>
                      <div className="flex gap-2">
                        <button 
                          onClick={playAudioSummary}
                          title={isPlayingAudio ? "Stop Reading" : labels.read_aloud}
                          disabled={audioLoading}
                          className={cn(
                            "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                            isPlayingAudio ? "bg-emerald-600 text-white" : "bg-[#F5F5F0] text-emerald-600 hover:bg-emerald-600/10",
                            audioLoading && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {audioLoading ? <Loader2 size={24} className="animate-spin" /> : (isPlayingAudio ? <VolumeX size={24} /> : <Volume2 size={24} />)}
                        </button>
                      </div>
                    </div>
                    
                    <p className="text-lg leading-relaxed text-[#1A1A1A]/90 whitespace-pre-wrap">
                      {response.answer}
                    </p>

                    {response.safetySection && (
                      <div className="mt-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                        <div className="flex items-center gap-2 text-rose-700 mb-2" title={labels.safety_first}>
                          <AlertTriangle size={18} />
                          <span className="text-sm font-bold uppercase tracking-wider">{labels.safety_first}</span>
                        </div>
                        <p className="text-sm text-rose-900 leading-relaxed whitespace-pre-wrap">
                          {response.safetySection}
                        </p>
                      </div>
                    )}

                    {audioUrl && (
                      <audio 
                        ref={audioRef} 
                        src={audioUrl} 
                        onEnded={() => setIsPlayingAudio(false)}
                        className="hidden" 
                      />
                    )}
                  </div>

                  {/* Mandi Prices */}
                  {response.mandiPrices && response.mandiPrices.length > 0 && (
                    <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4 flex items-center gap-2" title={labels.live_mandi}>
                        <ChevronRight size={14} /> {labels.live_mandi}
                      </h4>
                      <div className="space-y-3">
                        {response.mandiPrices.map((price, i) => (
                          <div key={i} className="flex items-center justify-between py-2 border-b border-[#5A5A40]/5 last:border-0">
                            <div>
                              <p className="font-bold text-[#1A1A1A]">{price.crop}</p>
                              <p className="text-xs text-[#5A5A40]/60">{price.market}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono font-bold text-[#5A5A40]">{price.price}</p>
                              <span className={cn(
                                "text-[10px] uppercase font-bold",
                                price.trend === 'up' ? "text-emerald-600" : price.trend === 'down' ? "text-rose-600" : "text-amber-600"
                              )}>
                                {price.trend}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Schemes */}
                  {response.schemes && response.schemes.length > 0 && (
                    <div className="bg-[#5A5A40] text-white p-6 rounded-3xl">
                      <h4 className="text-xs font-bold uppercase tracking-widest opacity-60 mb-4 flex items-center gap-2" title={labels.gov_schemes}>
                        <Info size={14} /> {labels.gov_schemes}
                      </h4>
                      <div className="space-y-4">
                        {response.schemes.map((scheme, i) => (
                          <div key={i} className="space-y-1">
                            <p className="font-bold">{scheme.name}</p>
                            <p className="text-xs opacity-80">{scheme.benefit}</p>
                            <a href={scheme.link} target="_blank" rel="noopener noreferrer" className="text-[10px] underline opacity-60 hover:opacity-100">{labels.learn_more}</a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pro Tips */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {response.proTips.map((tip, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 + i * 0.1 }}
                        className="bg-[#5A5A40] text-white p-5 rounded-3xl flex gap-3"
                      >
                        <CheckCircle2 className="shrink-0 mt-1" size={20} title={labels.pro_tip} />
                        <div>
                          <p className="text-xs uppercase tracking-widest opacity-60 mb-1">{labels.pro_tip} {i + 1}</p>
                          <p className="text-sm font-medium leading-snug">{tip}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Audio Summary Card */}
                  <button 
                    onClick={playAudioSummary}
                    className={cn(
                      "w-full text-left p-4 rounded-2xl border transition-all",
                      isPlayingAudio ? "bg-[#5A5A40] text-white border-[#5A5A40]" : "bg-[#E6E6D8] text-[#5A5A40] border-[#5A5A40]/10 hover:bg-[#5A5A40]/5"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2" title={labels.audio_summary}>
                      {isPlayingAudio ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      <span className="text-xs font-bold uppercase tracking-wider">{labels.audio_summary}</span>
                    </div>
                    <p className={cn(
                      "text-sm italic",
                      isPlayingAudio ? "text-white/80" : "text-[#5A5A40]"
                    )}>"{response.audioSummary}"</p>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {activeTab === 'khata' && (
          <div className="space-y-6">
            {!user ? (
              <div className="bg-white p-8 rounded-[32px] text-center border border-[#5A5A40]/10">
                <h3 className="text-2xl font-light mb-4">{labels.login_google}</h3>
                <p className="text-[#5A5A40]/60 mb-6">Your records will be saved securely in your account.</p>
                <button onClick={handleLogin} className="bg-[#5A5A40] text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs">
                  {labels.login_google}
                </button>
              </div>
            ) : (
              <>
                <div className="bg-white p-8 rounded-[32px] text-center border border-[#5A5A40]/10">
                  <div className="w-16 h-16 bg-[#F5F5F0] rounded-full flex items-center justify-center mx-auto mb-4 text-[#5A5A40]" title="Khata Info">
                    <Info size={32} />
                  </div>
                  <h3 className="text-2xl font-light mb-2">{labels.digital_khata}</h3>
                  <p className="text-[#5A5A40]/60 mb-6">{labels.total_expenses}: ₹{expenses.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString()}</p>
                  <button 
                    onClick={() => setShowExpenseModal(true)}
                    title={labels.add_expense}
                    className="bg-[#5A5A40] text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs flex items-center gap-2 mx-auto"
                  >
                    <Plus size={16} title="Add Icon" /> {labels.add_expense}
                  </button>
                </div>
                
                <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4">{labels.recent_transactions}</h4>
                  <div className="space-y-4">
                    {expenses.length === 0 ? (
                      <div className="text-center py-10 text-[#5A5A40]/40 italic">
                        {labels.no_transactions}
                      </div>
                    ) : (
                      expenses.map((expense) => (
                        <div key={expense.id} className="flex items-center justify-between py-3 border-b border-[#5A5A40]/5 last:border-0">
                          <div>
                            <p className="font-bold text-[#1A1A1A]">{expense.category}</p>
                            <p className="text-xs text-[#5A5A40]/60">{new Date(expense.date).toLocaleDateString()}</p>
                            {expense.description && <p className="text-[10px] text-[#5A5A40]/40 mt-1">{expense.description}</p>}
                          </div>
                          <div className="flex items-center gap-4">
                            <p className="font-mono font-bold text-[#5A5A40]">₹{expense.amount.toLocaleString()}</p>
                            <button onClick={() => handleDeleteExpense(expense.id)} className="text-rose-600/40 hover:text-rose-600 p-1" title="Delete Expense">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'market' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4 flex items-center gap-2" title={labels.check_mandi}>
                <ChevronRight size={14} /> {labels.check_mandi}
              </h4>
              
              {response?.mandiPrices && response.mandiPrices.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-[#5A5A40]/60">Latest prices from your last query:</p>
                  <div className="grid grid-cols-1 gap-3">
                    {response.mandiPrices.map((price, i) => (
                      <div key={i} className="bg-[#F5F5F0] p-4 rounded-2xl flex items-center justify-between">
                        <div>
                          <p className="font-bold text-[#1A1A1A]">{price.crop}</p>
                          <p className="text-xs text-[#5A5A40]/60">{price.market}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-bold text-[#5A5A40]">{price.price}</p>
                          <span className={cn(
                            "text-[10px] uppercase font-bold",
                            price.trend === 'up' ? "text-emerald-600" : price.trend === 'down' ? "text-rose-600" : "text-amber-600"
                          )}>
                            {price.trend}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-bg p-6 rounded-2xl">
                    <p className="text-xs font-bold uppercase tracking-widest text-primary/40 mb-4">{labels.trending_crops}</p>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { crop: 'Wheat', price: '₹2,275/q', trend: 'up' },
                        { crop: 'Rice (Paddy)', price: '₹2,183/q', trend: 'stable' },
                        { crop: 'Mustard', price: '₹5,450/q', trend: 'down' },
                        { crop: 'Cotton', price: '₹7,020/q', trend: 'up' },
                        { crop: 'Soyabean', price: '₹4,600/q', trend: 'up' },
                        { crop: 'Maize', price: '₹1,900/q', trend: 'stable' },
                        { crop: 'Barley', price: '₹2,100/q', trend: 'down' },
                        { crop: 'Groundnut', price: '₹6,200/q', trend: 'up' }
                      ].map((item, i) => (
                        <div key={i} className="bg-white p-3 rounded-xl border border-primary/5">
                          <p className="text-sm font-bold">{item.crop}</p>
                          <p className="text-xs font-mono text-primary">{item.price}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div 
                    className="text-center p-6 border border-dashed border-primary/20 rounded-2xl cursor-pointer hover:bg-primary/5 transition-colors"
                    onClick={() => {
                      const prices = [
                        { crop: 'Wheat', price: '2,275' },
                        { crop: 'Rice', price: '2,183' },
                        { crop: 'Mustard', price: '5,450' },
                        { crop: 'Cotton', price: '7,020' },
                        { crop: 'Soyabean', price: '4,600' },
                        { crop: 'Maize', price: '1,900' },
                        { crop: 'Barley', price: '2,100' },
                        { crop: 'Groundnut', price: '6,200' }
                      ];
                      const text = prices.map(p => `${p.crop} is ${p.price} rupees per quintal`).join('. ');
                      const utterance = new SpeechSynthesisUtterance(text);
                      utterance.lang = 'hi-IN'; // Defaulting to Hindi for now as per app context
                      window.speechSynthesis.speak(utterance);
                    }}
                  >
                    <Volume2 size={32} className="mx-auto mb-2 opacity-20 text-primary" title={labels.market_audio_info} />
                    <p className="text-xs text-primary/40">{labels.market_audio_info}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            {!user ? (
              <div className="bg-white p-8 rounded-[32px] text-center border border-[#5A5A40]/10">
                <h3 className="text-2xl font-light mb-4">{labels.login_history}</h3>
                <button onClick={handleLogin} className="bg-[#5A5A40] text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs">
                  {labels.login_google}
                </button>
              </div>
            ) : (
              <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4">{labels.history_title}</h4>
                <div className="space-y-6">
                  {diagnoses.length === 0 ? (
                    <div className="text-center py-10 text-[#5A5A40]/40 italic">
                      {labels.no_history}
                    </div>
                  ) : (
                    diagnoses.map((diag) => (
                      <div key={diag.id} className="space-y-3 pb-6 border-b border-[#5A5A40]/5 last:border-0 last:pb-0">
                        <div className="flex justify-between items-start">
                          <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest">{new Date(diag.timestamp).toLocaleString()}</p>
                          {diag.imageUrl && (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#5A5A40]/10">
                              <img src={diag.imageUrl} alt="Diagnosis" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm font-bold text-[#5A5A40]">Q: {diag.query || "Image Analysis"}</p>
                        <p className="text-sm text-[#1A1A1A]/70 line-clamp-3">{diag.diagnosis}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'field' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4 flex items-center gap-2" title={labels.satellite_map}>
                <Map size={14} /> {labels.satellite_map}
              </h4>
              <div className="relative aspect-square sm:aspect-video bg-[#F5F5F0] rounded-2xl overflow-hidden border border-[#5A5A40]/10">
                {/* Mock NDVI Map */}
                <div className="absolute inset-0 grid grid-cols-4 grid-rows-4">
                  {[...Array(16)].map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "transition-all duration-1000",
                        i % 5 === 0 ? "bg-emerald-500/40" : 
                        i % 3 === 0 ? "bg-amber-500/40" : "bg-emerald-600/60"
                      )}
                    />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl text-center shadow-lg">
                    <p className="text-xs font-bold text-[#5A5A40]">{labels.field_stress}</p>
                    <p className="text-[10px] text-[#5A5A40]/60">{labels.field_stress}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="bg-emerald-500/10 p-2 rounded-lg text-center">
                  <p className="text-[10px] font-bold text-emerald-700">Healthy</p>
                  <p className="text-xs font-bold">75%</p>
                </div>
                <div className="bg-amber-500/10 p-2 rounded-lg text-center">
                  <p className="text-[10px] font-bold text-amber-700">Stress</p>
                  <p className="text-xs font-bold">15%</p>
                </div>
                <div className="bg-rose-500/10 p-2 rounded-lg text-center">
                  <p className="text-[10px] font-bold text-rose-700">Critical</p>
                  <p className="text-xs font-bold">10%</p>
                </div>
              </div>

              {/* State-wise Field Stress */}
              <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10 mt-6">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4">State-wise Field Stress</h4>
                <div className="space-y-3">
                  {[
                    { state: 'Punjab', stress: 'Low' },
                    { state: 'Haryana', stress: 'Moderate' },
                    { state: 'Uttar Pradesh', stress: 'Low' },
                    { state: 'Madhya Pradesh', stress: 'High' },
                    { state: 'Maharashtra', stress: 'Moderate' }
                  ].map((item, i) => (
                    <div key={i} className="flex justify-between items-center bg-[#F5F5F0] p-3 rounded-xl">
                      <span className="text-sm font-bold">{item.state}</span>
                      <span className={cn(
                        "text-xs font-bold px-2 py-1 rounded-full",
                        item.stress === 'Low' ? "bg-emerald-100 text-emerald-800" : 
                        item.stress === 'Moderate' ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
                      )}>{item.stress}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Crop Health Tips */}
              <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10 mt-6">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4">Crop Health Tips</h4>
                <p className="text-sm text-[#5A5A40]/80">
                  Based on current stress levels, ensure adequate irrigation in high-stress areas. Monitor for pest outbreaks in moderate-stress regions.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'soil' && (
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-[32px] text-center border border-[#5A5A40]/10">
              <div className="w-16 h-16 bg-[#F5F5F0] rounded-full flex items-center justify-center mx-auto mb-4 text-[#5A5A40]" title="Soil Card">
                <FileText size={32} />
              </div>
              <h3 className="text-2xl font-light mb-2">{labels.soil_health_card}</h3>
              <p className="text-[#5A5A40]/60 mb-6">Upload your physical soil test report to get digital recommendations.</p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                title={labels.upload_report}
                className="bg-[#5A5A40] text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs flex items-center gap-2 mx-auto"
              >
                <Plus size={16} title="Upload Icon" /> {labels.upload_report}
              </button>
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-[#5A5A40]/10">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4">{labels.soil_parameters}</h4>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Nitrogen (N)', value: 'Low', color: 'text-rose-600' },
                  { label: 'Phosphorus (P)', value: 'Medium', color: 'text-amber-600' },
                  { label: 'Potassium (K)', value: 'High', color: 'text-emerald-600' },
                  { label: 'pH Level', value: '6.5', color: 'text-emerald-600' }
                ].map((stat, i) => (
                  <div key={i} className="bg-[#F5F5F0] p-4 rounded-2xl">
                    <p className="text-[10px] uppercase font-bold text-[#5A5A40]/40">{stat.label}</p>
                    <p className={cn("text-lg font-bold", stat.color)}>{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Input Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-[#5A5A40]/10 p-4 z-20">
        <div className="max-w-2xl mx-auto">
          {selectedImage && (
            <div className="mb-4 flex items-center gap-2 bg-[#5A5A40] text-white p-2 rounded-xl">
              <div className="w-10 h-10 bg-white/20 rounded flex items-center justify-center overflow-hidden">
                <img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} alt="Selected" className="object-cover w-full h-full" />
              </div>
              <span className="text-xs flex-1 truncate">{labels.image_selected}</span>
              <button onClick={() => setSelectedImage(null)} className="p-1 hover:bg-white/20 rounded" title={labels.remove_image}>
                <VolumeX size={16} />
              </button>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder={selectedImage ? "Describe the issue..." : labels.ask_query}
                className="w-full bg-[#F5F5F0] border-none rounded-full py-4 pl-6 pr-40 focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {queryText && (
                  <button 
                    type="button"
                    onClick={() => setQueryText('')}
                    className="p-2 text-[#5A5A40]/40 hover:text-[#5A5A40] rounded-full"
                    title={labels.clear_text}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                {chatHistory.length > 0 && (
                  <button 
                    type="button"
                    onClick={() => {
                      setChatHistory([]);
                      setResponse(null);
                    }}
                    className="p-2 text-[#5A5A40]/40 hover:text-rose-600 rounded-full"
                    title={labels.reset_chat}
                  >
                    <History size={16} />
                  </button>
                )}
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    selectedImage ? "text-[#5A5A40]" : "text-[#5A5A40]/40 hover:text-[#5A5A40]"
                  )}
                  title={labels.upload_crop_photo}
                >
                  <Plus size={20} className="rotate-45" />
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                </button>
                <button 
                  type="button"
                  onClick={startVoiceInput}
                  className={cn(
                    "p-2 transition-colors rounded-full",
                    isListening ? "text-rose-600 bg-rose-50 animate-pulse" : "text-[#5A5A40]/40 hover:text-[#5A5A40]"
                  )}
                  title={labels.voice_input}
                >
                  <Mic size={20} />
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || (!queryText.trim() && !selectedImage)}
              title={labels.submit}
              className="bg-[#5A5A40] text-white w-14 h-14 rounded-full flex items-center justify-center hover:bg-[#4A4A30] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#5A5A40]/20"
            >
              <Send size={24} />
            </button>
          </form>
          
          {/* Footer Disclaimer */}
          <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-[#5A5A40]/50 uppercase tracking-widest text-center">
            <div className="flex items-center gap-1" title={labels.safety_warning}>
              <AlertTriangle size={10} />
              <span>{labels.safety_warning}</span>
            </div>
            <div className="flex items-center gap-1" title={labels.general_info}>
              <Info size={10} />
              <span>{labels.verify_kvk}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expense Modal */}
      <AnimatePresence>
        {showExpenseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExpenseModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-light mb-6">{labels.add_expense_title}</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-[#5A5A40]/60 mb-1 block">{labels.category}</label>
                  <select 
                    value={newExpense.category}
                    onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl py-3 px-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                  >
                    {['Seeds', 'Fertilizer', 'Pesticide', 'Labor', 'Fuel', 'Other'].map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-[#5A5A40]/60 mb-1 block">{labels.amount}</label>
                  <input 
                    type="number"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl py-3 px-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-[#5A5A40]/60 mb-1 block">{labels.description}</label>
                  <textarea 
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                    placeholder={labels.optional_details}
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl py-3 px-4 focus:ring-2 focus:ring-[#5A5A40]/20 min-h-[100px]"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowExpenseModal(false)}
                    className="flex-1 py-3 rounded-full font-bold uppercase tracking-widest text-xs border border-[#5A5A40]/10 text-[#5A5A40]"
                  >
                    {labels.cancel}
                  </button>
                  <button 
                    onClick={handleAddExpense}
                    disabled={!newExpense.amount || isSavingExpense}
                    className="flex-1 py-3 bg-[#5A5A40] text-white rounded-full font-bold uppercase tracking-widest text-xs disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSavingExpense ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {labels.saving}
                      </>
                    ) : (
                      labels.save_record
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Terms Overlay */}
      <div className="fixed top-4 right-4 z-50">
        <button 
          onClick={() => setShowTermsModal(true)}
          title={labels.terms_conditions}
          className="bg-white/50 backdrop-blur-sm p-2 rounded-full border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all"
        >
          <Info size={20} title="Terms Icon" />
        </button>
      </div>

      {/* Terms Modal */}
      <AnimatePresence>
        {showTermsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTermsModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-[32px] p-8 shadow-2xl max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center gap-3 mb-6 text-[#5A5A40]">
                <div className="w-12 h-12 bg-[#F5F5F0] rounded-full flex items-center justify-center">
                  <FileText size={24} />
                </div>
                <h3 className="text-2xl font-light">{labels.terms_title}</h3>
              </div>
              
              <div className="space-y-6 text-sm text-[#1A1A1A]/80 leading-relaxed">
                <section>
                  <h4 className="font-bold text-[#5A5A40] uppercase tracking-widest text-[10px] mb-2">1. Informational Advice</h4>
                  <p>All agricultural advice provided by Kisan-Dost is for informational purposes only. It is based on AI analysis and should be cross-verified with local experts.</p>
                </section>

                <section>
                  <h4 className="font-bold text-[#5A5A40] uppercase tracking-widest text-[10px] mb-2">2. Chemical Safety</h4>
                  <p>When using pesticides or fertilizers, always follow the instructions on the product label strictly. Wear protective gear, including masks and waterproof gloves.</p>
                </section>

                <section>
                  <h4 className="font-bold text-[#5A5A40] uppercase tracking-widest text-[10px] mb-2">3. Expert Verification</h4>
                  <p>We strongly recommend verifying any critical farming decisions with your local Krishi Vigyan Kendra (KVK) or a certified agricultural officer.</p>
                </section>

                <section>
                  <h4 className="font-bold text-[#5A5A40] uppercase tracking-widest text-[10px] mb-2">4. Government Disclaimer</h4>
                  <p>Kisan-Dost is an AI assistant and NOT an official government representative. Eligibility for schemes must be verified at a CSC or Jan Seva Kendra.</p>
                </section>

                <section>
                  <h4 className="font-bold text-[#5A5A40] uppercase tracking-widest text-[10px] mb-2">5. Data Privacy</h4>
                  <p>Your Digital Khata and Diagnosis History are stored securely. We do not share your personal farming data with third parties without your consent.</p>
                </section>
              </div>

              <button 
                onClick={() => setShowTermsModal(false)}
                className="w-full mt-8 py-4 bg-[#5A5A40] text-white rounded-full font-bold uppercase tracking-widest text-xs shadow-lg shadow-[#5A5A40]/20"
              >
                {labels.i_understand}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

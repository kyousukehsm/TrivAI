import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Personality, GameState, TriviaQuestion, PersonalityId, TraitConfig, Difficulty, ScoreEntry } from './types';
import { PERSONALITIES, TOPICS } from './constants';
import { generateTriviaQuestion, generateSpeech, validateUsername } from './services/gemini';
import LiveChat from './components/LiveChat';
import AudioVisualizer from './components/Visualizer';
import { pcmToAudioBuffer } from './utils/audio';
import { useSound } from './hooks/useSound';
import { Play, Sparkles, MessageCircle, Volume2, VolumeX, ArrowRight, Trophy, BookOpen, AlertCircle, Smile, MessageSquare as MessageIcon, Zap, Gauge, Brain, Flame, Loader2, Key, LogOut, MicOff, Save, X, Medal, Crown } from 'lucide-react';

export default function App() {
  // Initialize API Key from LocalStorage if available
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('triviai_api_key') || process.env.API_KEY || '';
  });
  const [tempApiKey, setTempApiKey] = useState('');
  
  const [gameState, setGameState] = useState<GameState>(GameState.SETUP);
  
  const [selectedPersonalityId, setSelectedPersonalityId] = useState<PersonalityId>(PersonalityId.EXCITED_SHOWMAN);
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck');
  const [selectedTopic, setSelectedTopic] = useState(TOPICS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>(Difficulty.EASY);
  
  // Personality Traits State (now derived from selected personality)
  const [traits, setTraits] = useState<TraitConfig>(PERSONALITIES[0].traits);

  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [score, setScore] = useState(0);
  const [questionCount, setQuestionCount] = useState(0);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGeneratingTTS, setIsGeneratingTTS] = useState(false);
  const [isVoiceOffline, setIsVoiceOffline] = useState(false); // New state to track if TTS failed
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  
  // Session History to prevent repeats
  const [pastQuestions, setPastQuestions] = useState<string[]>([]);
  
  // Leaderboard State
  const [highScores, setHighScores] = useState<ScoreEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardFilter, setLeaderboardFilter] = useState<Difficulty>(Difficulty.EASY); // Filter state
  const [playerName, setPlayerName] = useState('');
  const [isSavingScore, setIsSavingScore] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [scoreSaved, setScoreSaved] = useState(false);

  // Sound System Hook
  const { isMuted, toggleMute, enableAudio, playSfx } = useSound(isSpeaking || isGeneratingTTS);

  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const activePersonality = PERSONALITIES.find(p => p.id === selectedPersonalityId) || PERSONALITIES[0];

  // Load High Scores on Mount
  useEffect(() => {
    const saved = localStorage.getItem('triviai_highscores');
    if (saved) {
      try {
        setHighScores(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse high scores", e);
      }
    }
  }, []);

  // Update default voice and traits when personality changes
  useEffect(() => {
    setSelectedVoice(activePersonality.voiceName);
    setTraits(activePersonality.traits);
  }, [activePersonality]);

  // Clear question history when topic changes to keep the exclusion list relevant
  useEffect(() => {
    setPastQuestions([]);
  }, [selectedTopic]);

  // Initialize Audio Context on first interaction
  const initAudio = async () => {
    let ctx = audioContext;
    if (!ctx) {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const anal = ctx.createAnalyser();
      anal.fftSize = 256;
      setAudioContext(ctx);
      setAnalyser(anal);
    }
    
    // Always try to resume if existing
    if (ctx && ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (e) {
            console.error("Audio Context Resume failed", e);
        }
    }
    return ctx;
  };

  const playAudio = async (base64Data: string) => {
    const ctx = await initAudio();
    if (!ctx || !analyser) return;

    try {
      if (currentAudioSourceRef.current) {
        try { currentAudioSourceRef.current.stop(); } catch (e) {}
      }

      const audioBuffer = pcmToAudioBuffer(base64Data, ctx, 24000);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      
      // Connect Source -> Analyser -> Destination
      source.connect(analyser);
      analyser.connect(ctx.destination);
      
      currentAudioSourceRef.current = source;
      setIsSpeaking(true);
      
      source.start(0);
      source.onended = () => {
        setIsSpeaking(false);
        currentAudioSourceRef.current = null;
      };
    } catch (e) {
      console.error("Audio playback error", e);
      setIsSpeaking(false);
    }
  };

  const loadNextQuestion = useCallback(async () => {
    setGameState(GameState.LOADING_QUESTION);
    setFeedbackMessage('');
    setIsVoiceOffline(false);
    
    try {
      // Pass pastQuestions to avoid repeats
      const qPromise = generateTriviaQuestion(apiKey, selectedTopic, activePersonality, traits, difficulty, pastQuestions);
      
      // We can't pre-generate TTS because we don't know the question yet.
      const q = await qPromise;
      
      setCurrentQuestion(q);
      
      // Update history with new question (keep last 20 to manage token limits)
      setPastQuestions(prev => [...prev, q.question].slice(-20));

      setGameState(GameState.PLAYING);
      
      // Host reads the question
      const textToRead = `Question ${questionCount + 1}: ${q.question}`;
      
      setIsGeneratingTTS(true);
      const audioData = await generateSpeech(apiKey, textToRead, selectedVoice);
      setIsGeneratingTTS(false);
      
      if (audioData) {
        playAudio(audioData);
      } else {
        // TTS Failed (likely quota), set silent mode
        setIsVoiceOffline(true);
      }
      
    } catch (e) {
      console.error("Failed to load question", e);
      setGameState(GameState.SETUP); 
    }
  }, [apiKey, selectedTopic, activePersonality, traits, selectedVoice, questionCount, difficulty, pastQuestions]); 

  const handleStartGame = useCallback(async () => {
    // CRITICAL FIX: Unlock Audio Context immediately on click
    await initAudio();
    enableAudio(); // Start Music
    playSfx('start'); // Play Start SFX
    
    setScore(0);
    setQuestionCount(0);
    setScoreSaved(false);
    setPlayerName('');
    // We do NOT clear pastQuestions here so that repeats are avoided across consecutive games in the same session
    loadNextQuestion();
  }, [loadNextQuestion, enableAudio, playSfx]);

  const handleAnswer = useCallback(async (index: number) => {
    if (!currentQuestion) return;
    
    // Resume audio context instantly to reduce perceived latency
    initAudio();
    setIsGeneratingTTS(true); // Show visual feedback immediately
    
    const isCorrect = index === currentQuestion.correctAnswerIndex;
    if (isCorrect) {
        setScore(s => s + 100);
        playSfx('correct');
    } else {
        playSfx('incorrect');
    }
    
    setGameState(GameState.RESULT);
    setQuestionCount(c => c + 1);

    // Host reaction
    const fullReaction = isCorrect ? currentQuestion.correctResponse : currentQuestion.incorrectResponse;
    setFeedbackMessage(fullReaction);
    
    // Generate speech
    const audioData = await generateSpeech(apiKey, fullReaction, selectedVoice);
    setIsGeneratingTTS(false);

    if (audioData) {
        playAudio(audioData);
    } else {
        setIsVoiceOffline(true);
    }
  }, [apiKey, currentQuestion, selectedVoice, playSfx]);

  const handleNext = useCallback(() => {
    playSfx('click');
    if (questionCount >= 5) {
        playSfx('win');
        setGameState(GameState.GAME_OVER); 
    } else {
        loadNextQuestion();
    }
  }, [questionCount, loadNextQuestion, playSfx]);

  const requestExit = useCallback(() => {
    playSfx('click');
    setShowExitConfirm(true);
  }, [playSfx]);

  const confirmExit = useCallback(() => {
    playSfx('click');
    if (currentAudioSourceRef.current) {
        try { currentAudioSourceRef.current.stop(); } catch (e) {}
    }
    setIsSpeaking(false);
    setShowExitConfirm(false);
    setGameState(GameState.SETUP);
  }, [playSfx]);

  const handleSaveKey = () => {
    playSfx('click');
    if (tempApiKey) {
        localStorage.setItem('triviai_api_key', tempApiKey);
        setApiKey(tempApiKey);
        enableAudio(); // Try to start audio after key entry
    }
  };

  const handleSaveScore = async () => {
    playSfx('click');
    if (!playerName.trim()) {
        setNameError("Please enter a name.");
        return;
    }
    
    setIsSavingScore(true);
    setNameError(null);

    // Validate Name via AI
    const isSafe = await validateUsername(apiKey, playerName);
    
    if (!isSafe) {
        setIsSavingScore(false);
        setNameError("That name was flagged as inappropriate. Please choose another.");
        playSfx('incorrect');
        return;
    }

    const newScore: ScoreEntry = {
        id: Date.now().toString(),
        playerName: playerName.trim(),
        score: score,
        date: new Date().toLocaleDateString(),
        topic: selectedTopic,
        personalityName: activePersonality.name,
        difficulty: difficulty // Save the difficulty
    };

    const updatedScores = [...highScores, newScore].sort((a, b) => b.score - a.score).slice(0, 50); // Keep top 50
    setHighScores(updatedScores);
    localStorage.setItem('triviai_highscores', JSON.stringify(updatedScores));
    
    setIsSavingScore(false);
    setScoreSaved(true);
    playSfx('correct');
    
    // Auto switch leaderboard filter to current difficulty so user sees their score
    setLeaderboardFilter(difficulty);
    setShowLeaderboard(true);
  };
  
  // -- RENDERERS --

  if (!apiKey) {
      return (
          <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
              <div className="bg-slate-900 p-8 rounded-2xl max-w-md w-full border border-slate-700 shadow-2xl animate-fadeIn">
                  <div className="flex justify-center mb-6">
                      <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
                          <Sparkles className="text-white w-8 h-8" />
                      </div>
                  </div>
                  <h1 className="text-2xl font-bold text-center text-white mb-2">Welcome to TrivAI</h1>
                  <p className="text-slate-400 text-center mb-6 text-sm">To start, please enter your Gemini API Key.</p>
                  
                  <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase mb-1 ml-1">Google Gemini API Key</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                            <input 
                                type="password" 
                                value={tempApiKey}
                                onChange={(e) => setTempApiKey(e.target.value)}
                                placeholder="AIzaSy..."
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all placeholder:text-slate-600 font-mono"
                            />
                        </div>
                      </div>
                      
                      <button 
                        onClick={handleSaveKey}
                        disabled={!tempApiKey}
                        className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-white font-bold hover:shadow-lg hover:shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        Start Experience
                      </button>
                      
                      <p className="text-xs text-center text-slate-500 mt-4">
                        Don't have a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">Get one for free here</a>.
                      </p>
                  </div>
              </div>
          </div>
      )
  }

  if (gameState === GameState.LIVE_CHAT) {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <LiveChat 
          personality={activePersonality} 
          traits={traits}
          onClose={requestExit} 
        />
        {showExitConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
                <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-sm w-full shadow-2xl transform scale-100 animate-scaleIn">
                    <div className="flex items-center gap-3 mb-4 text-red-400">
                        <AlertCircle className="w-6 h-6" />
                        <h3 className="text-xl font-bold text-white">End Session?</h3>
                    </div>
                    <p className="text-slate-400 mb-6">
                        Are you sure you want to end the chat session?
                    </p>
                    <div className="flex gap-3 justify-end">
                        <button 
                            onClick={() => setShowExitConfirm(false)}
                            className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={confirmExit}
                            className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/50 font-bold transition-colors"
                        >
                            End Session
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    );
  }

  // Filter high scores based on current filter state
  const filteredHighScores = highScores
    .filter(s => {
        // If save entry doesn't have difficulty (legacy data), default to EASY
        const d = s.difficulty || Difficulty.EASY;
        return d === leaderboardFilter;
    })
    .sort((a, b) => b.score - a.score);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="p-6 flex justify-between items-center border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent hidden md:block">
            TrivAI
          </h1>
        </div>
        
        <div className="flex items-center gap-2">
            <button
                onClick={toggleMute}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title={isMuted ? "Unmute Sound" : "Mute Sound"}
            >
                {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <button 
                onClick={() => {
                    playSfx('click');
                    setShowLeaderboard(true);
                }}
                className="p-2 hover:bg-slate-800 rounded-lg text-yellow-500 transition-colors"
                title="Leaderboard"
            >
                <Trophy className="w-6 h-6" />
            </button>
             {/* Score Display */}
             {gameState !== GameState.SETUP && (
                 <>
                    <div className="px-4 py-1 bg-slate-800 rounded-full border border-slate-700 flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-yellow-500"/>
                        <span className="font-mono font-bold text-yellow-400">{score}</span>
                    </div>
                    <button onClick={requestExit} className="text-sm text-slate-400 hover:text-white transition">Exit</button>
                 </>
             )}
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-1 container mx-auto p-4 md:p-8 max-w-4xl flex flex-col justify-center relative">
        
        {/* SETUP SCREEN */}
        {gameState === GameState.SETUP && (
          <div className="animate-fadeIn space-y-12">
            
            <section className="text-center space-y-4">
              <h2 className="text-4xl md:text-5xl font-bold text-white">Choose Your Host</h2>
              <p className="text-slate-400 text-lg">Who will quiz you today?</p>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {PERSONALITIES.map(p => (
                <button
                  key={p.id}
                  onMouseEnter={() => playSfx('hover')}
                  onClick={() => {
                      playSfx('click');
                      setSelectedPersonalityId(p.id);
                  }}
                  className={`relative p-6 rounded-2xl border-2 transition-all duration-300 text-left hover:scale-105 group ${
                    selectedPersonalityId === p.id 
                    ? 'border-cyan-500 bg-slate-800/80 shadow-xl shadow-cyan-500/10' 
                    : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'
                  }`}
                >
                  <div className="text-4xl mb-4 group-hover:animate-bounce">{p.avatar}</div>
                  <h3 className="text-xl font-bold text-white mb-2">{p.name}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{p.description}</p>
                  
                  {selectedPersonalityId === p.id && (
                    <div className="absolute top-4 right-4">
                      <div className="w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Config Section */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 md:p-8">
                <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-400" />
                    Game Configuration
                </h3>
                
                <div className="space-y-6">
                    {/* Difficulty Selection */}
                    <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
                         <div className="flex items-center gap-2 mb-4 text-slate-200 font-medium">
                            <Gauge className="w-4 h-4 text-cyan-400" /> Game Difficulty
                         </div>
                         <div className="flex flex-wrap gap-4">
                            <button
                                onClick={() => { playSfx('click'); setDifficulty(Difficulty.EASY); }}
                                className={`flex-1 px-4 py-3 rounded-xl border transition-all flex items-center justify-center gap-2 ${
                                    difficulty === Difficulty.EASY
                                    ? 'bg-green-500/20 border-green-500 text-green-100'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                                }`}
                            >
                                <Brain className="w-4 h-4" /> Easy
                            </button>
                            <button
                                onClick={() => { playSfx('click'); setDifficulty(Difficulty.MEDIUM); }}
                                className={`flex-1 px-4 py-3 rounded-xl border transition-all flex items-center justify-center gap-2 ${
                                    difficulty === Difficulty.MEDIUM
                                    ? 'bg-yellow-500/20 border-yellow-500 text-yellow-100'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                                }`}
                            >
                                <Zap className="w-4 h-4" /> Medium
                            </button>
                            <button
                                onClick={() => { playSfx('click'); setDifficulty(Difficulty.HARD); }}
                                className={`flex-1 px-4 py-3 rounded-xl border transition-all flex items-center justify-center gap-2 ${
                                    difficulty === Difficulty.HARD
                                    ? 'bg-red-500/20 border-red-500 text-red-100'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                                }`}
                            >
                                <Flame className="w-4 h-4" /> Hard
                            </button>
                         </div>
                    </div>
                </div>
            </div>

            <section className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                <label className="block text-slate-400 mb-4 text-sm font-semibold uppercase tracking-wider">Select Topic</label>
                <div className="flex flex-wrap gap-3">
                    {TOPICS.map(topic => (
                        <button
                            key={topic}
                            onClick={() => { playSfx('click'); setSelectedTopic(topic); }}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                                selectedTopic === topic
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                        >
                            {topic}
                        </button>
                    ))}
                </div>
            </section>

            <div className="flex gap-4 justify-center pt-8">
              <button
                onClick={handleStartGame}
                className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-200 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full focus:outline-none hover:shadow-lg hover:shadow-cyan-500/40 hover:-translate-y-1"
              >
                <Play className="w-5 h-5 mr-2 fill-current" />
                Start Trivia Game
              </button>
              
              <button
                onClick={() => {
                    playSfx('click');
                    initAudio(); // Pre-init audio context on click
                    enableAudio();
                    setGameState(GameState.LIVE_CHAT);
                }}
                className="inline-flex items-center justify-center px-8 py-4 font-bold text-slate-300 transition-all duration-200 bg-slate-800 border border-slate-700 rounded-full hover:bg-slate-700 hover:text-white"
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Just Chat (Live)
              </button>
            </div>
            
          </div>
        )}

        {/* LOADING STATE */}
        {gameState === GameState.LOADING_QUESTION && (
            <div className="flex flex-col items-center justify-center space-y-6 animate-pulse">
                {/* Thinking Animation Added */}
                <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center text-6xl animate-bounce-slow">
                    {activePersonality.avatar}
                </div>
                <h2 className="text-2xl font-medium text-slate-300">
                    {activePersonality.name} is thinking...
                </h2>
                <p className="text-slate-500 text-sm">Searching Google for verification...</p>
            </div>
        )}

        {/* PLAYING STATE */}
        {(gameState === GameState.PLAYING || gameState === GameState.RESULT) && currentQuestion && (
            <div className="max-w-2xl mx-auto w-full animate-fadeIn">
                
                {/* Host Area */}
                <div className="flex items-center gap-4 mb-8 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
                    {/* Speaking Animation Added */}
                    <div className={`text-4xl transition-transform duration-300 ${isSpeaking ? 'animate-speak' : ''}`}>
                        {activePersonality.avatar}
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-200">{activePersonality.name}</h3>
                                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                    difficulty === Difficulty.EASY ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                                    difficulty === Difficulty.MEDIUM ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10' :
                                    'border-red-500/50 text-red-400 bg-red-500/10'
                                }`}>
                                    {difficulty}
                                </span>
                                {isGeneratingTTS && (
                                     <div className="flex items-center gap-1.5 px-2 py-0.5 bg-cyan-500/10 rounded-full border border-cyan-500/30 ml-2">
                                         <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                                         <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide">Speaking...</span>
                                     </div>
                                )}
                                {isVoiceOffline && !isGeneratingTTS && (
                                     <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/10 rounded-full border border-red-500/30 ml-2" title="Voice disabled due to API limits">
                                         <MicOff className="w-3 h-3 text-red-400" />
                                         <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide">Voice Offline</span>
                                     </div>
                                )}
                            </div>
                            {isSpeaking && <Volume2 className="w-4 h-4 text-cyan-400 animate-pulse"/>}
                        </div>
                        {/* Use real-time analyser here */}
                        <AudioVisualizer isActive={isSpeaking} accentColor="#22d3ee" analyser={analyser} />
                    </div>
                </div>

                {/* Question Card */}
                <div className="bg-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl border border-slate-700/50 mb-6">
                    <div className="flex justify-between items-start mb-6">
                         <div className="flex gap-2">
                             <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase bg-cyan-400/10 px-3 py-1 rounded-full">
                                Question {questionCount + 1}
                             </span>
                         </div>
                         <span className="text-xs text-slate-500 uppercase tracking-wider">{selectedTopic}</span>
                    </div>
                    
                    <h2 className="text-2xl md:text-3xl font-bold text-white mb-8 leading-tight">
                        {currentQuestion.question}
                    </h2>

                    <div className="grid grid-cols-1 gap-3">
                        {/* Added optional chaining for options to prevent crash */}
                        {currentQuestion.options?.map((option, idx) => {
                            let stateClass = "bg-slate-700 hover:bg-slate-600 border-slate-600";
                            
                            if (gameState === GameState.RESULT) {
                                if (idx === currentQuestion.correctAnswerIndex) {
                                    stateClass = "bg-green-600/20 border-green-500 text-green-100";
                                } else if (idx !== currentQuestion.correctAnswerIndex) {
                                    stateClass = "bg-slate-800 border-slate-700 opacity-50";
                                }
                            }

                            return (
                                <button
                                    key={idx}
                                    onMouseEnter={() => playSfx('hover')}
                                    disabled={gameState === GameState.RESULT}
                                    onClick={() => handleAnswer(idx)}
                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all font-medium text-lg flex items-center gap-4 ${stateClass}`}
                                >
                                    <span className="w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center font-bold text-sm opacity-70">
                                        {String.fromCharCode(65 + idx)}
                                    </span>
                                    {option}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Result Area */}
                {gameState === GameState.RESULT && (
                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 animate-slideUp">
                        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                            <span className="text-2xl animate-speak">{activePersonality.avatar}</span>
                            Host says:
                        </h3>
                        <p className="text-slate-300 italic mb-4 border-l-4 border-cyan-500 pl-4 py-1">
                            "{feedbackMessage}"
                        </p>
                        
                        {currentQuestion.sourceUrl && (
                             <div className="flex items-center gap-2 text-xs text-slate-500 mb-6 bg-slate-900/50 p-2 rounded-lg inline-block">
                                <BookOpen className="w-3 h-3" />
                                <span>Source: <a href={currentQuestion.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-cyan-400 underline decoration-dotted">{currentQuestion.sourceTitle || 'Verified Web Source'}</a></span>
                             </div>
                        )}

                        <div className="flex justify-between items-center">
                            <button
                                onClick={handleNext}
                                className="flex items-center px-6 py-3 bg-white text-slate-900 rounded-full font-bold hover:bg-cyan-50 transition-colors ml-auto"
                            >
                                {questionCount >= 5 ? "Finish Game" : "Next Question"}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* GAME OVER & SCORE SUBMISSION */}
        {gameState === GameState.GAME_OVER && (
            <div className="max-w-md mx-auto w-full animate-fadeIn text-center">
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-8 shadow-2xl">
                    <div className="mb-6 flex justify-center">
                         <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-lg shadow-orange-500/20">
                             <Trophy className="w-10 h-10 text-white" />
                         </div>
                    </div>
                    
                    <h2 className="text-3xl font-bold text-white mb-2">Game Over!</h2>
                    <p className="text-slate-400 mb-6">Final Score on <span className="text-cyan-400">{difficulty}</span> mode</p>
                    <div className="text-6xl font-bold text-yellow-400 mb-8 font-mono">{score}</div>
                    
                    {!scoreSaved ? (
                        <div className="space-y-4">
                            <p className="text-sm text-slate-300">Enter your name to save your score:</p>
                            <div>
                                <input 
                                    type="text"
                                    value={playerName}
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    placeholder="Your Name"
                                    maxLength={15}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-center text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                                />
                                {nameError && <p className="text-red-400 text-xs mt-2">{nameError}</p>}
                            </div>
                            
                            <button
                                onClick={handleSaveScore}
                                disabled={isSavingScore || !playerName.trim()}
                                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50"
                            >
                                {isSavingScore ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> Checking Name...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-4 h-4" /> Save Score
                                    </>
                                )}
                            </button>
                            <button
                                onClick={() => { playSfx('click'); setGameState(GameState.SETUP); }}
                                className="w-full py-2 text-slate-500 hover:text-white text-sm"
                            >
                                Skip & Return Home
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-green-400 text-sm font-medium">
                                Score Saved Successfully!
                            </div>
                            <button
                                onClick={() => { playSfx('click'); setGameState(GameState.SETUP); }}
                                className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-all"
                            >
                                Play Again
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )}

      </main>

      {/* Leaderboard Modal */}
      {showLeaderboard && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn p-4">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-scaleIn overflow-hidden">
                  
                  {/* Modal Header */}
                  <div className="p-6 border-b border-slate-800 bg-slate-900/90 flex justify-between items-center sticky top-0 z-10">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-yellow-500/10 rounded-lg">
                            <Crown className="w-6 h-6 text-yellow-500" />
                          </div>
                          <div>
                            <h2 className="text-xl font-bold text-white">Leaderboard</h2>
                            <p className="text-xs text-slate-500">Top players by difficulty</p>
                          </div>
                      </div>
                      <button onClick={() => { playSfx('click'); setShowLeaderboard(false); }} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                          <X className="w-6 h-6" />
                      </button>
                  </div>
                  
                  {/* Difficulty Tabs */}
                  <div className="px-6 pt-6 pb-2 bg-slate-900">
                    <div className="flex p-1 bg-slate-800 rounded-xl">
                        {(Object.values(Difficulty) as Difficulty[]).map((level) => (
                            <button
                                key={level}
                                onClick={() => { playSfx('click'); setLeaderboardFilter(level); }}
                                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                                    leaderboardFilter === level 
                                    ? 'bg-slate-700 text-white shadow-lg' 
                                    : 'text-slate-400 hover:text-slate-300'
                                }`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                  </div>

                  <div className="overflow-y-auto flex-1 p-6 bg-slate-900">
                      {filteredHighScores.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                              <Trophy className="w-12 h-12 mb-4 opacity-20" />
                              <p className="text-lg font-medium">No scores yet for {leaderboardFilter}</p>
                              <p className="text-sm mt-1">Be the first to claim victory!</p>
                          </div>
                      ) : (
                          <div className="space-y-2">
                              {/* Header Row */}
                              <div className="grid grid-cols-12 text-xs uppercase tracking-wider text-slate-500 px-4 pb-2">
                                <div className="col-span-2 md:col-span-1">Rank</div>
                                <div className="col-span-6 md:col-span-5">Player</div>
                                <div className="col-span-4 md:col-span-3 text-right md:text-left">Score</div>
                                <div className="hidden md:block md:col-span-3">Date</div>
                              </div>

                              {filteredHighScores.map((entry, index) => {
                                  // Rank Styling
                                  let rankIcon = null;
                                  let rankClass = "text-slate-500 font-mono";
                                  let rowBg = "hover:bg-slate-800/50";
                                  
                                  if (index === 0) {
                                      rankIcon = <Medal className="w-5 h-5 text-yellow-400" />;
                                      rankClass = "text-yellow-400 font-bold";
                                      rowBg = "bg-yellow-500/5 border border-yellow-500/20";
                                  } else if (index === 1) {
                                      rankIcon = <Medal className="w-5 h-5 text-slate-300" />;
                                      rankClass = "text-slate-300 font-bold";
                                      rowBg = "bg-slate-500/5 border border-slate-500/20";
                                  } else if (index === 2) {
                                      rankIcon = <Medal className="w-5 h-5 text-amber-600" />;
                                      rankClass = "text-amber-600 font-bold";
                                      rowBg = "bg-orange-500/5 border border-orange-500/20";
                                  }

                                  return (
                                      <div key={entry.id} className={`grid grid-cols-12 items-center px-4 py-3 rounded-xl transition-all ${rowBg}`}>
                                          <div className={`col-span-2 md:col-span-1 flex items-center gap-2 ${rankClass}`}>
                                              {rankIcon || `#${index + 1}`}
                                          </div>
                                          <div className="col-span-6 md:col-span-5">
                                              <div className="font-bold text-white truncate pr-2">{entry.playerName}</div>
                                              <div className="text-[10px] text-slate-500 truncate">{entry.topic} • {entry.personalityName}</div>
                                          </div>
                                          <div className="col-span-4 md:col-span-3 text-right md:text-left">
                                              <span className="font-mono text-cyan-400 font-bold text-lg">{entry.score}</span>
                                          </div>
                                          <div className="hidden md:block md:col-span-3 text-xs text-slate-500">
                                              {entry.date}
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* Global Exit Confirmation Modal (for Game Mode) */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-sm w-full shadow-2xl transform scale-100 animate-scaleIn">
                <div className="flex items-center gap-3 mb-4 text-red-400">
                    <AlertCircle className="w-6 h-6" />
                    <h3 className="text-xl font-bold text-white">Exit Game?</h3>
                </div>
                <p className="text-slate-400 mb-6">
                    Are you sure you want to exit? All progress and score will be lost.
                </p>
                <div className="flex gap-3 justify-end">
                    <button 
                        onClick={() => { playSfx('click'); setShowExitConfirm(false); }}
                        className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={confirmExit}
                        className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/50 font-bold transition-colors"
                    >
                        Exit Game
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

export enum PersonalityId {
  SASSY_ROBOT = 'SASSY_ROBOT',
  VICTORIAN_GENTLEMAN = 'VICTORIAN_GENTLEMAN',
  EXCITED_SHOWMAN = 'EXCITED_SHOWMAN',
  CHILL_SURFER = 'CHILL_SURFER'
}

export interface TraitConfig {
  humor: number; // 0-100
  verbosity: number; // 0-100
  sarcasm: number; // 0-100
}

export interface Personality {
  id: PersonalityId;
  name: string;
  description: string;
  prompt: string;
  voiceName: string;
  avatar: string; // Emoji or simple representation
  traits: TraitConfig;
}

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD'
}

export interface TriviaQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  correctResponse: string;
  incorrectResponse: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

export enum GameState {
  SETUP = 'SETUP',
  LOADING_QUESTION = 'LOADING_QUESTION',
  PLAYING = 'PLAYING',
  RESULT = 'RESULT',
  GAME_OVER = 'GAME_OVER',
  LIVE_CHAT = 'LIVE_CHAT'
}

export interface ScoreEntry {
  id: string;
  playerName: string;
  score: number;
  date: string;
  topic: string;
  personalityName: string;
  difficulty: Difficulty; // Added difficulty field
}

export interface AudioVisualizerProps {
  stream?: MediaStream;
  audioContext?: AudioContext;
  analyser?: AnalyserNode;
  isActive: boolean;
  color?: string;
}

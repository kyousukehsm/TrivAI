<p align="center">
  <img src="logo.jpg" width="400" alt="TrivAI Logo">
</p>

# TrivAI

TrivAI is a generative game-show experience. Unlike traditional, static quiz applications, TrivAI leverages large language models to create a dynamic environment where every question, reaction, and commentary is generated in real-time by a virtual host.

---

## Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React + Vite | High-speed development and optimized builds |
| **Language** | TypeScript | Robust type-safety across the game engine |
| **AI Engine** | Gemini 1.5 Pro | Real-time natural language and question generation |
| **Styling** | Tailwind CSS | Clean, responsive, and game-dev inspired UI |

---

## Key Features

* **Interactive AI Host:** A specialized personality providing context-aware commentary based on player performance.
* **Infinite Variety:** Questions are generated on-the-fly across any category, ensuring unique sessions every time.
* **Real-time Voice Synthesis:** Integrated audio processing to bring the host's personality to life.
* **Modular Architecture:** Utilizes custom hooks like useVoiceControl and useSound for a clean, maintainable codebase.

---

## Local Development

### Prerequisites
* **Node.js** (v18.0.0 or higher)
* A valid **Gemini API Key**

### Installation

1.  **Clone the repository:**
    ```cmd
    git clone [https://github.com/kyousukehsm/TrivAI.git](https://github.com/kyousukehsm/TrivAI.git)
    cd TrivAI
    ```

2.  **Install dependencies:**
    ```cmd
    npm install
    ```

3.  **Configure Environment:**
    Create a .env.local file in the root directory and add your key:
    ```text
    VITE_GEMINI_API_KEY=your_actual_key_here
    ```

4.  **Launch Application:**
    ```cmd
    npm run dev
    ```

---

## Deployment

This application is designed to be self-hosted. For production builds, run the following command and deploy the resulting dist folder to your preferred hosting provider:

```cmd
npm run build
```


## License
This project is licensed under the MIT License - see the LICENSE file for details.

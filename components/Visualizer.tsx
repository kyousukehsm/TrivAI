import React, { useEffect, useRef } from 'react';

interface Props {
  isActive: boolean;
  accentColor: string;
  analyser?: AnalyserNode | null;
}

const AudioVisualizer: React.FC<Props> = ({ isActive, accentColor, analyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let t = 0;
    
    // Buffer for frequency data
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = analyser ? new Uint8Array(bufferLength) : null;

    const render = () => {
      // Resize handling
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = canvas.width;
      const h = canvas.height;
      const centerY = h / 2;

      if (isActive) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = accentColor;
        ctx.lineCap = 'round';
        ctx.beginPath();

        if (analyser && dataArray) {
          // Real-time frequency visualization
          analyser.getByteTimeDomainData(dataArray);
          
          const sliceWidth = w / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * (h / 2);

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);

            x += sliceWidth;
          }
          ctx.stroke();
        } else {
          // Fallback simulation
          for (let x = 0; x < w; x++) {
            const y = centerY + Math.sin(x * 0.05 + t) * (20 + Math.sin(t * 0.5) * 10); 
            const y2 = Math.sin(x * 0.02 - t * 1.5) * 10;
            
            if (x === 0) ctx.moveTo(x, y + y2);
            else ctx.lineTo(x, y + y2);
          }
          ctx.stroke();
          t += 0.2;
        }
      } else {
        // Flatline
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#334155'; // Slate-700
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, accentColor, analyser]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-24 bg-slate-900 rounded-xl border border-slate-700 shadow-inner"
    />
  );
};

export default AudioVisualizer;

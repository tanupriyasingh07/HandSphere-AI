# HandSphere AI

Interactive 3D particle sphere controlled by real-time hand tracking using **MediaPipe Hands** and **WebGL**.

## Overview

HandSphere AI is an experimental browser-based AI interaction project where a 3D particle sphere responds to hand movements captured through a webcam.

The project combines computer vision with GPU-accelerated graphics to create an interactive experience entirely inside the browser without external rendering engines.

## Features

- Real-time hand tracking using MediaPipe Hands
- Interactive 3D particle sphere
- GPU-accelerated WebGL rendering
- Smooth palm position tracking
- Hand tilt detection
- 360° sphere animation
- Particle glow shader
- Webcam integration
- Real-time FPS monitor
- Clean modular TypeScript architecture

## Tech Stack

- TypeScript
- WebGL2
- GLSL Shaders
- MediaPipe Hands
- HTML5 Canvas
- CSS3

## Project Structure

```
HandSphere-AI/
│
├── src/
│   ├── lib/
│   ├── shaders/
│   ├── App.tsx
│   └── ...
│
├── scripts/
├── artifacts/
├── package.json
└── README.md
```

## How It Works

1. Webcam captures live video.
2. MediaPipe detects hand landmarks.
3. Palm center is calculated.
4. Position is smoothed using interpolation.
5. Hand rotation controls sphere tilt.
6. Particle system is rendered using WebGL.
7. Custom shaders generate glow and lighting effects.

## Current Progress

### Completed

- WebGL particle renderer
- 3D particle sphere
- Particle glow shaders
- Uniform particle distribution
- 360° sphere rotation
- Webcam support
- MediaPipe hand tracking
- Palm position tracking
- Hand tilt detection
- Smooth motion interpolation

### Planned

- Gesture recognition
- Grab interaction
- Pinch detection
- Particle explosion effects
- Dynamic color transitions
- Multi-hand support
- Physics-based particle simulation

## Installation

Clone the repository

```bash
git clone https://github.com/tanupriyasingh07/HandSphere-AI.git
```

Go into the project

```bash
cd HandSphere-AI
```

Install dependencies

```bash
npm install
```

Start development server

```bash
npm run dev
```

## Future Improvements

- Gesture-controlled UI
- AI-powered interactions
- Object manipulation
- VR/AR support
- Three-dimensional particle physics
- Better lighting and bloom

## Author

**Tanupriya Singh**

B.Tech CSE (Artificial Intelligence)

Galgotias University

GitHub:
https://github.com/tanupriyasingh07

---

This project is currently under active development.

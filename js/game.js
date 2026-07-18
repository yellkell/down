/*
 * Game State Manager
 * Handles start screen, collision detection, game over, and win states.
 */

AFRAME.registerSystem('game-manager', {
    schema: {
        state: { type: 'string', default: 'START' },
        lives: { type: 'number', default: 1 }
    },

    init: function () {
        console.log("Game Manager Initialized");
        this.timeElapsed = 0;
        this.gridDuration = 30;
        this.currentPhase = 1;
        this.totalPhases = 3;
        this.gameEnded = false;
        this.gameStarted = false;

        this.phaseHeights = [150, 75, 0];
        this.winnerHeight = -150; // Extended for longer final slide
        this.playerRadius = 0.1;

        this.el.addEventListener('slide-complete', this.onSlideComplete.bind(this));
        this.el.addEventListener('final-slide-complete', this.onFinalSlideComplete.bind(this));

        if (this.sceneEl.hasLoaded) {
            this.createUI();
        } else {
            this.sceneEl.addEventListener('loaded', this.createUI.bind(this));
        }
    },

    createUI: function () {
        const camera = document.querySelector('#camera');
        const rig = document.querySelector('#rig');
        if (!camera || !rig) return;

        // Get controller references for laser visibility control
        this.leftHand = document.querySelector('#left-hand');
        this.rightHand = document.querySelector('#right-hand');

        // Player head hitbox (INVISIBLE)
        this.playerHead = document.createElement('a-sphere');
        this.playerHead.setAttribute('radius', this.playerRadius);
        this.playerHead.setAttribute('position', '0 0 0');
        this.playerHead.setAttribute('visible', 'false');
        camera.appendChild(this.playerHead);

        // HUD Text - stylized neon look
        this.hudText = document.createElement('a-text');
        this.hudText.setAttribute('position', '0 2 -8');
        this.hudText.setAttribute('scale', '2.5 2.5 2.5');
        this.hudText.setAttribute('value', '');
        this.hudText.setAttribute('color', '#00ffff');
        this.hudText.setAttribute('align', 'center');
        this.hudText.setAttribute('font', 'mozillavr');
        rig.appendChild(this.hudText);

        // Start Screen Panel - vertically centered layout
        this.startPanel = document.createElement('a-entity');
        this.startPanel.setAttribute('position', '0 1.6 -10'); // At eye level

        const startBg = document.createElement('a-plane');
        startBg.setAttribute('width', '8');
        startBg.setAttribute('height', '7');
        startBg.setAttribute('material', 'color: #000; opacity: 0.85');
        this.startPanel.appendChild(startBg);

        // Title image at top
        const titleImage = document.createElement('a-image');
        titleImage.setAttribute('src', 'assets/drop.png');
        titleImage.setAttribute('position', '0 2.5 0.01');
        titleImage.setAttribute('width', '5');
        titleImage.setAttribute('height', '2');
        titleImage.setAttribute('material', 'transparent: true; alphaTest: 0.5');
        this.startPanel.appendChild(titleImage);

        // Safety warning text - centered in middle of remaining space
        const warningInfo = document.createElement('a-text');
        warningInfo.setAttribute('value', 'CLEAR A 1.8m x 1.8m SPACE IRL\nCENTER YOURSELF WITHIN IT\nRECENTER VIEW WITH YOUR CONTROLLER\n\nLET\'S GO!');
        warningInfo.setAttribute('position', '0 0 0.01'); // Vertically centered
        warningInfo.setAttribute('scale', '0.8 0.8 0.8');
        warningInfo.setAttribute('color', '#ffffff');
        warningInfo.setAttribute('align', 'center');
        warningInfo.setAttribute('baseline', 'center');
        this.startPanel.appendChild(warningInfo);

        // BEGIN button at bottom, vertically aligned with text
        const startBtn = document.createElement('a-plane');
        startBtn.setAttribute('width', '3');
        startBtn.setAttribute('height', '1');
        startBtn.setAttribute('position', '0 -2.2 0.01'); // Bottom of panel
        startBtn.setAttribute('material', 'color: #00ff00; emissive: #00ff00; emissiveIntensity: 0.5');
        startBtn.setAttribute('class', 'clickable');
        startBtn.addEventListener('click', () => this.startGame());
        this.startPanel.appendChild(startBtn);

        // Stylized BEGIN button text
        const startBtnText = document.createElement('a-text');
        startBtnText.setAttribute('value', 'BEGIN');
        startBtnText.setAttribute('position', '0 -2.2 0.02');
        startBtnText.setAttribute('scale', '1.8 1.8 1.8');
        startBtnText.setAttribute('color', '#000');
        startBtnText.setAttribute('align', 'center');
        startBtnText.setAttribute('font', 'mozillavr');
        this.startPanel.appendChild(startBtnText);

        rig.appendChild(this.startPanel);

        // Set initial laser visibility (visible because start panel is showing)
        this.setLaserVisibility(true);

        // Game Over Panel
        this.gameOverPanel = document.createElement('a-entity');
        this.gameOverPanel.setAttribute('position', '0 2 -10');
        this.gameOverPanel.setAttribute('visible', false);

        const goBg = document.createElement('a-plane');
        goBg.setAttribute('width', '8');
        goBg.setAttribute('height', '5');
        goBg.setAttribute('material', 'color: #000; opacity: 0.9');
        this.gameOverPanel.appendChild(goBg);

        // Stylized game over title
        this.goTitle = document.createElement('a-text');
        this.goTitle.setAttribute('value', 'GAME OVER');
        this.goTitle.setAttribute('position', '0 1 0.01');
        this.goTitle.setAttribute('scale', '2.5 2.5 2.5');
        this.goTitle.setAttribute('color', '#ff0000');
        this.goTitle.setAttribute('align', 'center');
        this.goTitle.setAttribute('font', 'mozillavr');
        this.gameOverPanel.appendChild(this.goTitle);

        const resetBtn = document.createElement('a-plane');
        resetBtn.setAttribute('width', '3');
        resetBtn.setAttribute('height', '1');
        resetBtn.setAttribute('position', '0 -0.5 0.01');
        resetBtn.setAttribute('material', 'color: #ffff00; emissive: #ffff00; emissiveIntensity: 0.5');
        resetBtn.setAttribute('class', 'clickable');
        resetBtn.addEventListener('click', () => window.location.reload());
        this.gameOverPanel.appendChild(resetBtn);

        // Stylized RESET button text
        const resetBtnText = document.createElement('a-text');
        resetBtnText.setAttribute('value', 'RESET');
        resetBtnText.setAttribute('position', '0 -0.5 0.02');
        resetBtnText.setAttribute('scale', '1.8 1.8 1.8');
        resetBtnText.setAttribute('color', '#000');
        resetBtnText.setAttribute('align', 'center');
        resetBtnText.setAttribute('font', 'mozillavr');
        this.gameOverPanel.appendChild(resetBtnText);

        rig.appendChild(this.gameOverPanel);


        // Warning texts
        this.warningText = document.createElement('a-text');
        this.warningText.setAttribute('position', '0 0 -8');
        this.warningText.setAttribute('scale', '3 3 3');
        this.warningText.setAttribute('value', 'LOOK DOWN!\nWATCH OUT!');
        this.warningText.setAttribute('color', '#ff0000');
        this.warningText.setAttribute('align', 'center');
        this.warningText.setAttribute('visible', false);
        rig.appendChild(this.warningText);

        // Slide warning - stylized neon look
        this.slideWarning = document.createElement('a-text');
        this.slideWarning.setAttribute('position', '0 0 -8');
        this.slideWarning.setAttribute('scale', '3.5 3.5 3.5');
        this.slideWarning.setAttribute('value', 'LOOK FORWARD!\n↓ SLIDE ↓');
        this.slideWarning.setAttribute('color', '#ff00ff');
        this.slideWarning.setAttribute('align', 'center');
        this.slideWarning.setAttribute('font', 'mozillavr');
        this.slideWarning.setAttribute('visible', false);
        rig.appendChild(this.slideWarning);

        // Rising red warning from below (visual slide warning) with text
        const gridFloor = document.querySelector('#grid-floor');
        if (gridFloor) {
            // Container for warning elements
            this.risingWarning = document.createElement('a-entity');
            this.risingWarning.setAttribute('position', '0 -10 0'); // Start below the grid
            this.risingWarning.setAttribute('visible', false);

            // Red plane
            const warningPlane = document.createElement('a-plane');
            warningPlane.setAttribute('width', '3');
            warningPlane.setAttribute('height', '3');
            warningPlane.setAttribute('rotation', '-90 0 0'); // Flat on ground
            warningPlane.setAttribute('material', {
                color: '#ff0000',
                emissive: '#ff0000',
                emissiveIntensity: 2,
                transparent: true,
                opacity: 0.6,
                shader: 'flat',
                side: 'double'
            });
            this.risingWarning.appendChild(warningPlane);

            // "LOOK UP!" text on the warning
            const lookUpText = document.createElement('a-text');
            lookUpText.setAttribute('value', 'LOOK UP!');
            lookUpText.setAttribute('position', '0 0.1 0');
            lookUpText.setAttribute('rotation', '-90 0 0'); // Flat, readable from above
            lookUpText.setAttribute('scale', '3 3 3');
            lookUpText.setAttribute('color', '#ffffff');
            lookUpText.setAttribute('align', 'center');
            lookUpText.setAttribute('baseline', 'center');
            this.risingWarning.appendChild(lookUpText);

            gridFloor.appendChild(this.risingWarning);
            this.warningRiseActive = false;
            this.warningRiseY = -10; // Start position
        }

        // Load sound effects
        this.beginSound = new Audio('assets/begin.ogg');
        this.awesomeSound = new Audio('assets/awesome.ogg');
        this.gameoverSound = new Audio('assets/gameover.ogg');
        this.dieSound = new Audio('assets/die.ogg');
        this.excellentSound = new Audio('assets/excellent.ogg');

        // Load music playlist
        this.musicTracks = [
            new Audio('assets/Digital Paradisio.mp3'),
            new Audio('assets/Island Circuits.mp3'),
            new Audio('assets/Island Pixelio.mp3'),
            new Audio('assets/Island Pixels.mp3')
        ];
        this.currentTrack = 0;

        this.musicTracks.forEach((track) => {
            track.addEventListener('ended', () => this.playNextTrack());
        });
    },

    setLaserVisibility: function (visible) {
        // Control the visibility of the laser pointers on controllers
        if (this.leftHand && this.leftHand.components['laser-controls']) {
            const leftLine = this.leftHand.components['laser-controls'].line;
            if (leftLine) leftLine.visible = visible;
        }
        if (this.rightHand && this.rightHand.components['laser-controls']) {
            const rightLine = this.rightHand.components['laser-controls'].line;
            if (rightLine) rightLine.visible = visible;
        }
    },

    playNextTrack: function () {
        this.currentTrack = (this.currentTrack + 1) % this.musicTracks.length;
        this.musicTracks[this.currentTrack].currentTime = 0;
        this.musicTracks[this.currentTrack].play().catch(e => console.log('Music error:', e));
    },

    startMusic: function () {
        this.musicTracks[0].currentTime = 0;
        this.musicTracks[0].play().catch(e => console.log('Music error:', e));
    },

    startGame: function () {
        console.log("Game Starting!");
        this.gameStarted = true;
        this.gameEnded = false;
        this.data.state = 'GRID';
        this.timeElapsed = 0;
        this.currentPhase = 1;

        this.startPanel.setAttribute('visible', false);
        this.gameOverPanel.setAttribute('visible', false);

        // Hide laser pointers during gameplay
        this.setLaserVisibility(false);

        // Show look down warning
        this.warningText.setAttribute('visible', true);
        setTimeout(() => {
            if (this.warningText) this.warningText.setAttribute('visible', false);
        }, 3000);

        // PLAY BEGIN SOUND FIRST
        if (this.beginSound) {
            this.beginSound.currentTime = 0;
            this.beginSound.play().then(() => {
                console.log("Begin sound played!");
            }).catch(e => console.log('Begin sound error:', e));
        }

        // Start music after a short delay
        setTimeout(() => this.startMusic(), 500);

        this.el.emit('game-start');
    },

    tick: function (time, timeDelta) {
        if (!this.gameStarted || this.gameEnded) return;

        this.checkCollisions();

        if (this.data.state !== 'GRID') return;

        this.timeElapsed += timeDelta / 1000;

        const remaining = Math.max(0, this.gridDuration - this.timeElapsed).toFixed(0);
        this.hudText.setAttribute('value', `Phase ${this.currentPhase}/${this.totalPhases} | ${remaining}s`);

        const timeUntilSlide = this.gridDuration - this.timeElapsed;

        // Show slide warning 3 seconds before slide
        if (timeUntilSlide <= 3 && timeUntilSlide > 2.5) {
            this.slideWarning.setAttribute('visible', true);

            // Activate rising warning
            if (this.risingWarning && !this.warningRiseActive) {
                this.warningRiseActive = true;
                this.warningRiseY = -10; // Reset to bottom
                this.risingWarning.setAttribute('visible', true);
            }

            // STOP grid spawner from spawning new projectiles and clear existing ones
            const gridSpawner = this.sceneEl.systems['grid-spawner'];
            if (gridSpawner && gridSpawner.isActive) {
                gridSpawner.isActive = false; // Stop spawning
                gridSpawner.clearProjectiles(); // Clear all existing projectiles
                console.log("Cleared projectiles for slide transition");
            }
        }

        // Animate rising warning during last 3 seconds
        if (this.warningRiseActive && timeUntilSlide <= 3 && timeUntilSlide > 0) {
            const dt = timeDelta / 1000;
            // Rise up over 3 seconds from Y=-10 to Y=0 (at grid level)
            this.warningRiseY += (10 / 3) * dt; // Rise 10 units over 3 seconds
            this.warningRiseY = Math.min(this.warningRiseY, 0); // Cap at 0

            // Pulsing opacity effect
            const pulse = 0.4 + Math.sin(time * 0.005) * 0.2; // Pulse between 0.2 and 0.6

            if (this.risingWarning) {
                this.risingWarning.object3D.position.y = this.warningRiseY;
                this.risingWarning.setAttribute('material', 'opacity', pulse);
            }
        }

        if (this.timeElapsed >= this.gridDuration) {
            this.slideWarning.setAttribute('visible', false);

            // Hide rising warning
            if (this.risingWarning) {
                this.risingWarning.setAttribute('visible', false);
                this.warningRiseActive = false;
            }

            this.startSlidePhase();
        }
    },

    checkCollisions: function () {
        if (!this.playerHead || this.gameEnded) return;

        const headWorldPos = new THREE.Vector3();
        this.playerHead.object3D.getWorldPosition(headWorldPos);

        // Check GRID projectiles
        const gridSpawner = this.sceneEl.systems['grid-spawner'];
        if (gridSpawner && this.data.state === 'GRID') {
            const projectiles = gridSpawner.getProjectiles();
            for (let proj of projectiles) {
                if (!proj.container) continue;
                const projPos = new THREE.Vector3();
                proj.container.object3D.getWorldPosition(projPos);
                const distance = headWorldPos.distanceTo(projPos);
                if (distance < this.playerRadius + (proj.radius || 0.3)) {
                    this.gameOver();
                    return;
                }
            }

            // Check KILL ZONE boundary (only during grid phase)
            if (gridSpawner.isOutsideKillZone(headWorldPos)) {
                console.log("Player went outside kill zone!");
                this.gameOver();
                return;
            }
        }

        // Check SLIDE obstacles - use box collision for tall barriers
        const slideMechanic = this.sceneEl.systems['slide-mechanic'];
        if (slideMechanic && this.data.state === 'SLIDE') {
            const obstacles = slideMechanic.getObstacles();
            for (let ob of obstacles) {
                if (!ob || !ob.object3D) continue;
                const obPos = new THREE.Vector3();
                ob.object3D.getWorldPosition(obPos);

                // Box collision - barriers are 0.25 wide, 2.4 tall, 0.15 deep
                const halfWidth = 0.15;
                const halfHeight = 1.2; // Half of 2.4
                const halfDepth = 0.1;

                // Check if head is within the box bounds
                const dx = Math.abs(headWorldPos.x - obPos.x);
                const dy = Math.abs(headWorldPos.y - obPos.y);
                const dz = Math.abs(headWorldPos.z - obPos.z);

                if (dx < halfWidth + this.playerRadius &&
                    dy < halfHeight + this.playerRadius &&
                    dz < halfDepth + this.playerRadius) {
                    this.gameOver();
                    return;
                }
            }
        }
    },

    startSlidePhase: function () {
        if (this.currentPhase >= this.totalPhases) {
            this.startFinalSlide();
            return;
        }

        console.log(`Starting Slide Phase after Grid ${this.currentPhase}`);
        this.data.state = 'SLIDE';
        this.hudText.setAttribute('value', 'SLIDING DOWN!');

        this.el.emit('phase-change', {
            newPhase: 'SLIDE',
            targetY: this.phaseHeights[this.currentPhase]
        });
    },

    startFinalSlide: function () {
        console.log("Starting FINAL slide!");
        this.data.state = 'SLIDE';
        this.hudText.setAttribute('value', 'FINAL SLIDE!');

        this.el.emit('phase-change', {
            newPhase: 'SLIDE',
            targetY: this.winnerHeight,
            isFinal: true
        });
    },

    onSlideComplete: function () {
        if (this.gameEnded) return;

        this.currentPhase++;
        this.timeElapsed = 0;

        if (this.currentPhase > this.totalPhases) {
            this.startFinalSlide();
        } else {
            console.log(`Starting Grid Phase ${this.currentPhase}`);

            if (this.excellentSound) {
                this.excellentSound.currentTime = 0;
                this.excellentSound.play().catch(e => console.log('Sound error:', e));
            }

            // Show warning again
            this.warningText.setAttribute('visible', true);
            setTimeout(() => {
                if (this.warningText) this.warningText.setAttribute('visible', false);
            }, 2000);

            // Start grid after delay
            setTimeout(() => {
                if (this.beginSound) {
                    this.beginSound.currentTime = 0;
                    this.beginSound.play().catch(e => console.log('Sound error:', e));
                }
                this.data.state = 'GRID';
                this.el.emit('phase-change', { newPhase: 'GRID' });
            }, 1000);
        }
    },

    onFinalSlideComplete: function () {
        console.log("YOU WIN!");
        this.gameEnded = true;
        this.data.state = 'WIN';

        this.goTitle.setAttribute('value', 'YOU MADE IT!\nCONGRATZ!');
        this.goTitle.setAttribute('color', '#00ff00');
        this.gameOverPanel.setAttribute('visible', true);
        this.hudText.setAttribute('value', '');

        // Show laser pointers for menu interaction
        this.setLaserVisibility(true);

        if (this.awesomeSound) {
            this.awesomeSound.currentTime = 0;
            this.awesomeSound.play().catch(e => console.log('Sound error:', e));
        }

        this.el.emit('phase-change', { newPhase: 'WIN' });
    },

    gameOver: function () {
        this.gameEnded = true;
        this.data.state = 'GAME_OVER';

        this.goTitle.setAttribute('value', 'GAME OVER');
        this.goTitle.setAttribute('color', '#ff0000');
        this.gameOverPanel.setAttribute('visible', true);
        this.hudText.setAttribute('value', '');

        // Show laser pointers for menu interaction
        this.setLaserVisibility(true);

        if (this.dieSound) {
            this.dieSound.currentTime = 0;
            this.dieSound.play().catch(e => console.log('Sound error:', e));
        }

        if (this.gameoverSound) {
            this.gameoverSound.currentTime = 0;
            this.gameoverSound.play().catch(e => console.log('Sound error:', e));
        }

        this.el.emit('phase-change', { newPhase: 'GAME_OVER' });
    }
});

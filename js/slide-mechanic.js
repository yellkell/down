/*
 * Slide Mechanic System
 * Rectangle barriers stuck in the slide that player must dodge.
 * Positioned left, center, or right - always dodgeable.
 */

AFRAME.registerSystem('slide-mechanic', {
    init: function () {
        this.active = false;
        this.speed = 20.0;
        this.targetY = 0;
        this.obstacles = [];

        this.sceneEl.addEventListener('phase-change', (evt) => {
            if (evt.detail.newPhase === 'SLIDE') {
                this.targetY = evt.detail.targetY || 0;
                this.isFinalSlide = evt.detail.isFinal || false;
                this.startSlide();
            } else if (evt.detail.newPhase === 'GRID') {
                this.active = false;
                this.clearObstacles();
            } else if (evt.detail.newPhase === 'WIN' || evt.detail.newPhase === 'GAME_OVER') {
                this.active = false;
            }
        });
    },

    startSlide: function () {
        console.log("Slide System Activated");
        this.active = true;
        this.rig = document.querySelector('#rig');
        this.gridFloor = document.querySelector('#grid-floor');

        this.spawnSlideObstacles();
    },

    spawnSlideObstacles: function () {
        if (!this.rig) return;

        const startY = this.rig.object3D.position.y;
        const startZ = this.rig.object3D.position.z;
        const endY = this.targetY;
        const slideAngle = 20;
        const rad = slideAngle * (Math.PI / 180);

        const heightDiff = startY - endY;
        const slideLength = heightDiff / Math.sin(rad);

        // Difficulty scaling
        let spacing, patterns;

        if (this.isFinalSlide) {
            // FINAL SLIDE - Same as level 2, not harder
            spacing = 18;
            patterns = ['left', 'right', 'center', 'left', 'right'];
        } else if (startY > 100) {
            // EASY - first slide
            spacing = 25;
            patterns = ['left', 'center', 'right', 'left', 'right'];
        } else {
            // MEDIUM - second slide
            spacing = 18;
            patterns = ['left', 'right', 'center', 'left', 'center', 'right'];
        }

        const count = Math.floor(slideLength / spacing);
        console.log("Spawning", count, "barriers, spacing:", spacing);

        for (let i = 1; i <= count; i++) {
            const dist = i * spacing;
            const dz = -Math.cos(rad) * dist;
            const dy = -Math.sin(rad) * dist;

            const posY = startY + dy;
            const posZ = startZ + dz;

            const pattern = patterns[i % patterns.length];

            // Spawn barrier(s) based on pattern
            if (pattern === 'left') {
                this.spawnBarrier(-0.4, posY, posZ);
            } else if (pattern === 'center') {
                this.spawnBarrier(0, posY, posZ);
            } else if (pattern === 'right') {
                this.spawnBarrier(0.4, posY, posZ);
            } else if (pattern === 'left-center') {
                this.spawnBarrier(-0.3, posY, posZ);
                this.spawnBarrier(0.15, posY, posZ);
            } else if (pattern === 'center-right') {
                this.spawnBarrier(-0.15, posY, posZ);
                this.spawnBarrier(0.3, posY, posZ);
            }
        }
    },

    spawnBarrier: function (x, y, z) {
        const colors = ['#ff0000', '#ff00ff', '#ff6600', '#ffff00'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Rectangle barrier - narrow width, stuck in the slide
        const width = 0.25;  // Narrow enough to dodge
        const height = 2.4;  // DOUBLED - Tall enough to really block the player
        const depth = 0.15;  // Thin barrier

        const container = document.createElement('a-entity');
        // Position so bottom touches slide surface
        container.setAttribute('position', { x: x, y: y + height / 2, z: z });
        container.setAttribute('class', 'slide-obstacle');
        container.setAttribute('data-radius', 0.3);

        // Black fill box
        const fill = document.createElement('a-box');
        fill.setAttribute('width', width * 0.9);
        fill.setAttribute('height', height * 0.9);
        fill.setAttribute('depth', depth * 0.9);
        fill.setAttribute('material', { color: '#000000', shader: 'flat' });
        container.appendChild(fill);

        // Glowing wireframe edges
        const wireframe = document.createElement('a-box');
        wireframe.setAttribute('width', width);
        wireframe.setAttribute('height', height);
        wireframe.setAttribute('depth', depth);
        wireframe.setAttribute('material', {
            color: color,
            emissive: color,
            emissiveIntensity: 2,
            wireframe: true
        });
        container.appendChild(wireframe);

        this.sceneEl.appendChild(container);
        this.obstacles.push(container);
    },

    getObstacles: function () {
        return this.obstacles;
    },

    clearObstacles: function () {
        this.obstacles.forEach(ob => {
            if (ob && ob.parentNode) ob.parentNode.removeChild(ob);
        });
        this.obstacles = [];
    },

    tick: function (time, timeDelta) {
        if (!this.active || !this.rig) return;

        const dt = timeDelta / 1000;
        const rad = 20 * (Math.PI / 180);

        const dy = -Math.sin(rad) * this.speed * dt;
        const dz = -Math.cos(rad) * this.speed * dt;

        this.rig.object3D.position.y += dy;
        this.rig.object3D.position.z += dz;

        if (this.gridFloor) {
            this.gridFloor.object3D.position.y = this.rig.object3D.position.y;
            this.gridFloor.object3D.position.z = this.rig.object3D.position.z;
        }

        // Check if reached target
        if (this.rig.object3D.position.y <= this.targetY + 1) {
            console.log("Slide Complete! Final:", this.isFinalSlide);
            this.active = false;
            this.clearObstacles();

            this.rig.object3D.position.y = this.targetY;
            if (this.gridFloor) {
                this.gridFloor.object3D.position.y = this.targetY;
            }

            if (this.isFinalSlide) {
                this.sceneEl.emit('final-slide-complete');
            } else {
                this.sceneEl.emit('slide-complete');
            }
        }
    }
});

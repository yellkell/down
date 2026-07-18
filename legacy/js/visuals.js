/*
 * Visuals System
 * Handles Neon Shaders, Materials, and Custom Obstacle Shapes
 */

// Helper function to create neon-edged obstacle (black center, glowing edges)
function createNeonObstacle(scene, shapeType, position, scale, color) {
    const container = document.createElement('a-entity');
    container.setAttribute('position', position);

    // Random shape types for variety
    const shapes = ['box', 'tetrahedron', 'octahedron', 'dodecahedron'];
    const shape = shapeType || shapes[Math.floor(Math.random() * shapes.length)];

    // Black center fill
    const fill = document.createElement('a-entity');
    fill.setAttribute('geometry', {
        primitive: shape,
        radius: (scale || 1) * 0.45
    });
    fill.setAttribute('material', {
        color: '#000000',
        shader: 'flat'
    });
    container.appendChild(fill);

    // Glowing wireframe edges
    const wireframe = document.createElement('a-entity');
    wireframe.setAttribute('geometry', {
        primitive: shape,
        radius: (scale || 1) * 0.5
    });

    const glowColor = color || ['#00ffff', '#ff00ff', '#00ff00', '#ffff00'][Math.floor(Math.random() * 4)];
    wireframe.setAttribute('material', {
        color: glowColor,
        emissive: glowColor,
        emissiveIntensity: 1.5,
        wireframe: true,
        wireframeLinewidth: 3
    });
    container.appendChild(wireframe);

    scene.appendChild(container);
    return container;
}

// Register as global
window.createNeonObstacle = createNeonObstacle;

AFRAME.registerComponent('neon-grid', {
    init: function () {
        // Grid visualization is handled by grid-spawner system
    }
});

AFRAME.registerComponent('neon-glow', {
    schema: {
        color: { type: 'color', default: '#00ff00' }
    },
    init: function () {
        const mesh = this.el.getObject3D('mesh');
        if (mesh) {
            mesh.traverse((node) => {
                if (node.isMesh) {
                    node.material.emissive = new THREE.Color(this.data.color);
                    node.material.emissiveIntensity = 1.0;
                }
            });
        }
    }
});

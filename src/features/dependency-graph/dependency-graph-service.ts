import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';

/**
 * Interface for graph node data
 */
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  filePath: string;
}

/**
 * Interface for graph edge data
 */
export interface GraphEdge {
  source: string;
  target: string;
  type: 'dependency' | 'dependent';
}

/**
 * Interface for graph data
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Service to handle dependency graph operations
 */
export const DependencyGraphService = {
  /**
   * Creates graph data from symbol index
   * @param symbolIndex - The symbol index to process
   * @returns Graph data for visualization
   */
  createGraphData(symbolIndex: SymbolIndex): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeMap = new Map<string, boolean>();
    
    // Process all symbols in the index
    Object.values(symbolIndex).forEach(fileSymbols => {
      fileSymbols.forEach(symbol => {
        // Create a unique ID for the symbol
        const nodeId = `${symbol.filePath}:${symbol.name}`;
        
        // Add node if it doesn't already exist
        if (!nodeIds.has(nodeId)) {
          nodeIds.add(nodeId);
          nodes.push({
            id: nodeId,
            label: symbol.name,
            type: symbol.type,
            filePath: symbol.filePath
          });
        }
        
        // Process dependencies
        symbol.depends_on.forEach(dep => {
          const targetId = `${dep.filePath}:${dep.name}`;
          const edgeId = `${nodeId}->${targetId}`;
          
          if (!edgeMap.has(edgeId)) {
            edgeMap.set(edgeId, true);
            edges.push({
              source: nodeId,
              target: targetId,
              type: 'dependency'
            });
          }
        });
        
        // Process dependents
        symbol.dependents.forEach(dep => {
          const sourceId = `${dep.filePath}:${dep.name}`;
          const edgeId = `${sourceId}->${nodeId}`;
          
          if (!edgeMap.has(edgeId)) {
            edgeMap.set(edgeId, true);
            edges.push({
              source: sourceId,
              target: nodeId,
              type: 'dependent'
            });
          }
        });
      });
    });
    
    return { nodes, edges };
  },
  
  /**
   * Creates the HTML content for the dependency graph visualization
   * @param graphData - The graph data to visualize
   * @returns HTML content as string
   */
  createVisualizationHtml(graphData: GraphData): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dependency Graph Visualization</title>
  <script src="https://unpkg.com/d3@7.8.5/dist/d3.min.js"></script>
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    }
    
    #graph-container {
      width: 100%;
      height: 100vh;
      background-color: #f5f5f5;
    }
    
    .controls {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1000;
      background-color: rgba(255, 255, 255, 0.9);
      padding: 10px;
      border-radius: 4px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    }
    
    .node {
      cursor: pointer;
    }
    
    .link {
      stroke-opacity: 0.6;
      stroke-width: 1.5px;
    }
    
    .node text {
      font-size: 12px;
      pointer-events: none;
    }
    
    .tooltip {
      position: absolute;
      background-color: rgba(255, 255, 255, 0.9);
      border-radius: 4px;
      padding: 10px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      display: none;
    }
  </style>
</head>
<body>
  <div class="controls">
    <button id="zoom-in">Zoom In</button>
    <button id="zoom-out">Zoom Out</button>
    <button id="reset">Reset</button>
    <input type="text" id="search" placeholder="Search nodes...">
  </div>
  <div id="graph-container"></div>
  <div class="tooltip" id="tooltip"></div>
  
  <script>
    // Graph data
    const graphData = ${JSON.stringify(graphData)};
    
    // Setup
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Create a color scale based on node type
    const typeColorMap = {
      'function': '#4285F4',
      'class': '#EA4335',
      'interface': '#FBBC05',
      'type': '#34A853',
      'variable': '#8F00FF',
      'method': '#00ACC1',
      'enum': '#FF6D00',
      'other': '#757575'
    };
    
    // Create SVG
    const svg = d3.select('#graph-container')
      .append('svg')
      .attr('width', width)
      .attr('height', height);
    
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });
    
    svg.call(zoom);
    
    const container = svg.append('g');
    
    // Create force simulation
    const simulation = d3.forceSimulation(graphData.nodes)
      .force('link', d3.forceLink(graphData.edges)
        .id(d => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));
    
    // Create links
    const link = container.append('g')
      .selectAll('line')
      .data(graphData.edges)
      .enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke', '#999')
      .attr('stroke-width', 1);
    
    // Create nodes
    const node = container.append('g')
      .selectAll('.node')
      .data(graphData.nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));
    
    // Add circles to nodes
    node.append('circle')
      .attr('r', 8)
      .attr('fill', d => typeColorMap[d.type] || typeColorMap.other)
      .on('mouseover', showTooltip)
      .on('mouseout', hideTooltip);
    
    // Add labels to nodes
    node.append('text')
      .attr('dx', 12)
      .attr('dy', '.35em')
      .text(d => d.label);
    
    // Tooltip functionality
    function showTooltip(event, d) {
      const tooltip = d3.select('#tooltip');
      tooltip.style('display', 'block')
        .html(\`
          <strong>Name:</strong> \${d.label}<br>
          <strong>Type:</strong> \${d.type}<br>
          <strong>File:</strong> \${d.filePath}
        \`)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px');
    }
    
    function hideTooltip() {
      d3.select('#tooltip').style('display', 'none');
    }
    
    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
      
      node.attr('transform', d => \`translate(\${d.x}, \${d.y})\`);
    });
    
    // Drag functions
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    
    // Controls
    d3.select('#zoom-in').on('click', () => {
      svg.transition().call(zoom.scaleBy, 1.2);
    });
    
    d3.select('#zoom-out').on('click', () => {
      svg.transition().call(zoom.scaleBy, 0.8);
    });
    
    d3.select('#reset').on('click', () => {
      svg.transition().call(zoom.transform, d3.zoomIdentity);
    });
    
    d3.select('#search').on('input', function() {
      const term = this.value.toLowerCase();
      
      // Reset all nodes and links
      node.classed('highlight', false)
        .select('circle')
        .attr('r', 8)
        .attr('fill', d => typeColorMap[d.type] || typeColorMap.other);
      
      link.attr('stroke', '#999').attr('stroke-width', 1);
      
      if (term) {
        // Highlight matching nodes
        const matchingNodes = graphData.nodes.filter(n => 
          n.label.toLowerCase().includes(term) || 
          n.filePath.toLowerCase().includes(term)
        ).map(n => n.id);
        
        node.filter(d => matchingNodes.includes(d.id))
          .classed('highlight', true)
          .select('circle')
          .attr('r', 12)
          .attr('fill', d => d3.color(typeColorMap[d.type] || typeColorMap.other).brighter(0.5));
      }
    });
    
    // Resize handler
    window.addEventListener('resize', () => {
      svg.attr('width', window.innerWidth).attr('height', window.innerHeight);
      simulation.force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2));
      simulation.restart();
    });
  </script>
</body>
</html>
`;
  },

  /**
   * Gets the path to save the generated HTML file
   * @param rootPath - The workspace root path
   * @returns The path for the visualization HTML
   */
  getVisualizationPath(rootPath: string): string {
    const dirPath = path.join(rootPath, '.cursortest');
    return path.join(dirPath, 'dependency-graph.html');
  },

  /**
   * Generates and saves the dependency graph visualization
   * @param rootPath - The workspace root path
   * @returns Promise that resolves when the visualization is saved
   */
  async generateVisualization(rootPath: string): Promise<string> {
    // Read the symbol index
    const symbolIndex = await SymbolIndexService.readSymbolIndex(rootPath);
    
    if (!symbolIndex) {
      throw new Error('Symbol index not found. Run "Build Symbol Index" command first.');
    }
    
    // Create graph data
    const graphData = this.createGraphData(symbolIndex);
    
    // Generate HTML content
    const htmlContent = this.createVisualizationHtml(graphData);
    
    // Ensure directory exists
    const visualizationPath = this.getVisualizationPath(rootPath);
    await fs.ensureDir(path.dirname(visualizationPath));
    
    // Write HTML file
    await fs.writeFile(visualizationPath, htmlContent, 'utf8');
    
    return visualizationPath;
  }
}; 
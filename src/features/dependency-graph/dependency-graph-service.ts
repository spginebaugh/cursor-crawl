import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { SymbolIndexWithScores } from '@/shared/types/symbol-index-with-scores';

/**
 * Interface for graph node data
 */
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  filePath: string;
  duplicateScore?: number;
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
  hasDuplicateAnalysis: boolean;
}

/**
 * Interface for duplicate analysis data
 */
export interface DuplicateAnalysisData {
  [filePath: string]: number;
}

/**
 * Service to handle dependency graph operations
 */
export const DependencyGraphService = {
  /**
   * Creates graph data from symbol index
   * @param symbolIndex - The symbol index to process
   * @param duplicateAnalysisData - Optional duplicate analysis data
   * @returns Graph data for visualization
   */
  createGraphData(symbolIndex: SymbolIndex, duplicateAnalysisData?: DuplicateAnalysisData): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeMap = new Map<string, boolean>();
    const hasDuplicateAnalysis = !!duplicateAnalysisData && Object.keys(duplicateAnalysisData).length > 0;
    
    // Process all symbols in the index
    Object.values(symbolIndex).forEach(fileSymbols => {
      fileSymbols.forEach(symbol => {
        // Create a unique ID for the symbol
        const nodeId = `${symbol.filePath}:${symbol.name}`;
        
        // Add node if it doesn't already exist
        if (!nodeIds.has(nodeId)) {
          nodeIds.add(nodeId);
          
          const node: GraphNode = {
            id: nodeId,
            label: symbol.name,
            type: symbol.type,
            filePath: symbol.filePath
          };
          
          // Add duplicate score if available
          if (hasDuplicateAnalysis && duplicateAnalysisData?.[symbol.filePath]) {
            node.duplicateScore = duplicateAnalysisData[symbol.filePath];
          }
          
          nodes.push(node);
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
    
    return { nodes, edges, hasDuplicateAnalysis };
  },
  
  /**
   * Reads duplicate analysis data from file if it exists
   * @param rootPath - The workspace root path
   * @returns Duplicate analysis data or undefined if not found
   */
  async readDuplicateAnalysisData(rootPath: string): Promise<DuplicateAnalysisData | undefined> {
    try {
      const analysisPath = path.join(rootPath, '.cursortest', 'duplicate-analysis.json');
      
      if (await fs.pathExists(analysisPath)) {
        const content = await fs.readFile(analysisPath, 'utf8');
        return JSON.parse(content) as DuplicateAnalysisData;
      }
      
      return undefined;
    } catch (error) {
      console.error('Error reading duplicate analysis data:', error);
      return undefined;
    }
  },

  /**
   * Reads the merged JSON file if it exists
   * @param rootPath - The workspace root path
   * @returns The merged symbol index with scores or undefined if not found
   */
  async readMergedJsonData(rootPath: string): Promise<SymbolIndexWithScores | undefined> {
    try {
      const mergedJsonPath = path.join(rootPath, '.cursortest', 'merged-json-for-viz.json');
      
      if (await fs.pathExists(mergedJsonPath)) {
        console.log(`Found merged JSON at ${mergedJsonPath}`);
        const content = await fs.readFile(mergedJsonPath, 'utf8');
        return JSON.parse(content) as SymbolIndexWithScores;
      }
      
      console.log('Merged JSON file not found');
      return undefined;
    } catch (error) {
      console.error('Error reading merged JSON data:', error);
      return undefined;
    }
  },

  /**
   * Creates graph data from merged symbol index with scores
   * @param mergedJson - The merged symbol index with scores
   * @returns Graph data for visualization
   */
  createGraphDataFromMergedJson(mergedJson: SymbolIndexWithScores): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeMap = new Map<string, boolean>();
    const hasDuplicateAnalysis = Object.values(mergedJson).some(fileSymbols => 
      fileSymbols.some(symbol => symbol.scores?.some(score => score.type === 'duplicateAnalysis'))
    );
    
    // Process all symbols in the merged index
    Object.values(mergedJson).forEach(fileSymbols => {
      fileSymbols.forEach(symbol => {
        // Create a unique ID for the symbol
        const nodeId = `${symbol.filePath}:${symbol.name}`;
        
        // Add node if it doesn't already exist
        if (!nodeIds.has(nodeId)) {
          nodeIds.add(nodeId);
          
          const node: GraphNode = {
            id: nodeId,
            label: symbol.name,
            type: symbol.type,
            filePath: symbol.filePath
          };
          
          // Add duplicate score if available
          const duplicateScore = symbol.scores?.find(score => score.type === 'duplicateAnalysis');
          if (duplicateScore) {
            node.duplicateScore = duplicateScore.score;
          }
          
          nodes.push(node);
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
    
    return { nodes, edges, hasDuplicateAnalysis };
  },
  
  /**
   * Creates the HTML content for the dependency graph visualization
   * @param graphData - The graph data to visualize
   * @returns HTML content as string
   */
  createVisualizationHtml(graphData: GraphData): string {
    // Build the view toggle buttons HTML - only include duplicate view button if we have duplicate analysis data
    const viewToggleButtonsHtml = graphData.hasDuplicateAnalysis 
      ? `
    <span>View: </span>
    <button id="dependency-view" class="active">Dependency</button>
    <button id="duplicate-view">Duplicate</button>
    `
      : `
    <span>View: </span>
    <button id="dependency-view" class="active">Dependency</button>
    `;

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

    .view-toggle {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 1000;
      background-color: rgba(255, 255, 255, 0.9);
      padding: 10px;
      border-radius: 4px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    }

    .view-toggle button {
      padding: 5px 10px;
      border: 1px solid #ccc;
      background: #fff;
      cursor: pointer;
      margin-left: 5px;
    }

    .view-toggle button.active {
      background: #4285F4;
      color: white;
      border-color: #2b5fb4;
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

    .legend {
      position: absolute;
      bottom: 20px;
      right: 20px;
      background-color: rgba(255, 255, 255, 0.9);
      padding: 10px;
      border-radius: 4px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      display: none;
      z-index: 1000;
    }

    .legend.show {
      display: block;
    }

    .legend-item {
      display: flex;
      align-items: center;
      margin-bottom: 5px;
    }

    .legend-color {
      width: 20px;
      height: 20px;
      margin-right: 10px;
      border: 1px solid #ccc;
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

  <div class="view-toggle">
    ${viewToggleButtonsHtml}
  </div>

  <div id="graph-container"></div>
  <div class="tooltip" id="tooltip"></div>

  <div id="duplicate-legend" class="legend">
    <h3>Duplicate Score</h3>
    <div class="legend-item">
      <div class="legend-color" style="background-color: #ffffff;"></div>
      <span>Score 1 (Low duplication)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background-color: #ffcccc;"></div>
      <span>Score 2</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background-color: #ff9999;"></div>
      <span>Score 3</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background-color: #ff6666;"></div>
      <span>Score 4</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background-color: #cc0000;"></div>
      <span>Score 5 (High duplication)</span>
    </div>
  </div>
  
  <script>
    // Graph data
    const graphData = ${JSON.stringify(graphData)};
    
    // Setup
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Current view mode
    let currentView = 'dependency';
    
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

    // Create a color scale for duplicate scores
    const duplicateColorScale = d3.scaleLinear()
      .domain([1, 5])
      .range(['#ffffff', '#cc0000'])
      .clamp(true);
    
    // Debug: Log number of nodes with duplicate scores
    console.log('Nodes with duplicate scores:', graphData.nodes.filter(n => n.duplicateScore !== undefined).length);
    console.log('Total nodes:', graphData.nodes.length);
    console.log('Has duplicate analysis:', graphData.hasDuplicateAnalysis);
    
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
    const circles = node.append('circle')
      .attr('r', 8)
      .attr('fill', d => getNodeColor(d, currentView))
      .on('mouseover', showTooltip)
      .on('mouseout', hideTooltip);
    
    // Add labels to nodes
    node.append('text')
      .attr('dx', 12)
      .attr('dy', '.35em')
      .text(d => d.label);

    // Function to get node color based on current view
    function getNodeColor(d, view) {
      if (view === 'duplicate' && d.duplicateScore !== undefined) {
        // Debug score to color mapping
        const color = duplicateColorScale(d.duplicateScore);
        console.log('Node:', d.label, 'Score:', d.duplicateScore, 'Color:', color);
        return color;
      } else {
        return typeColorMap[d.type] || typeColorMap.other;
      }
    }
    
    // Tooltip functionality
    function showTooltip(event, d) {
      const tooltip = d3.select('#tooltip');
      let content = \`
        <strong>Name:</strong> \${d.label}<br>
        <strong>Type:</strong> \${d.type}<br>
        <strong>File:</strong> \${d.filePath}
      \`;
      
      if (d.duplicateScore !== undefined) {
        content += \`<br><strong>Duplicate Score:</strong> \${d.duplicateScore}\`;
      }
      
      tooltip.style('display', 'block')
        .html(content)
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
    
    // View toggle buttons
    d3.select('#dependency-view').on('click', function() {
      if (currentView !== 'dependency') {
        currentView = 'dependency';
        updateViewMode();
      }
    });

    if (graphData.hasDuplicateAnalysis) {
      d3.select('#duplicate-view').on('click', function() {
        if (currentView !== 'duplicate') {
          currentView = 'duplicate';
          updateViewMode();
        }
      });
    }

    function updateViewMode() {
      console.log('Updating view mode to:', currentView);
      
      // Update button states
      d3.select('#dependency-view').classed('active', currentView === 'dependency');
      d3.select('#duplicate-view').classed('active', currentView === 'duplicate');
      
      // Update node colors - force reapplication of colors
      circles.attr('fill', d => getNodeColor(d, currentView));
      
      // Show/hide duplicate legend
      d3.select('#duplicate-legend').classed('show', currentView === 'duplicate');
    }
    
    d3.select('#search').on('input', function() {
      const term = this.value.toLowerCase();
      
      // Reset all nodes and links
      node.classed('highlight', false)
        .select('circle')
        .attr('r', 8)
        .attr('fill', d => getNodeColor(d, currentView));
      
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
          .attr('fill', d => {
            const baseColor = getNodeColor(d, currentView);
            return d3.color(baseColor).brighter(0.5);
          });
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
    let graphData: GraphData;
    
    // First try to read the merged JSON with scores
    const mergedJson = await this.readMergedJsonData(rootPath);
    
    if (mergedJson) {
      console.log('Using merged JSON with scores for visualization');
      graphData = this.createGraphDataFromMergedJson(mergedJson);
    } else {
      // Fall back to the original approach
      console.log('Falling back to original symbol index and duplicate analysis');
      
      // Read the symbol index
      const symbolIndex = await SymbolIndexService.readSymbolIndex(rootPath);
      
      if (!symbolIndex) {
        throw new Error('Symbol index not found. Run "Build Symbol Index" command first.');
      }
      
      // Read duplicate analysis data if available
      const duplicateAnalysisData = await this.readDuplicateAnalysisData(rootPath);
      
      // Create graph data
      graphData = this.createGraphData(symbolIndex, duplicateAnalysisData);
    }
    
    // Add a duplicate view button only if we have duplicate analysis
    if (graphData.hasDuplicateAnalysis) {
      console.log('Duplicate analysis data found, adding duplicate view button');
    }
    
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
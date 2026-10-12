# FareGrid
Website Url - https://vercel.com/advik-koul/faregird-sem3-mini-project

**Intercity All-Pairs Travel Cost Analyzer using the Floyd–Warshall algorithm**

Analysis & Design of Algorithms Mini Project, Sem 3 · Problem Sr. No. 17 · Module 4: Dynamic Programming

FareGrid computes the cheapest travel cost between **every pair of cities** in a road network, rebuilds the route for any trip, lists unreachable pairs and detects negative cycles. The algorithm is written in **C**. It ships both as the menu-driven console program required by the problem statement and as a web app, where the same C code is compiled to WebAssembly and runs in the browser.

---

## Problem statement (Sr. No. 17)

> Create a console application that computes the minimum travel cost between every pair of cities.
> A cost matrix is updated by considering each city as an allowed intermediate point. Users can query any source–destination pair after processing.

| | |
| --- | --- |
| **Input** | Number and names of cities, adjacency cost matrix, no-edge indicator, route queries |
| **Output** | Final all-pairs distance matrix, cheapest cost for any pair, reconstructed route, unreachable pairs, negative-cycle warning |
| **Implementation** | C · GUI not required · Database not required |

---

## Algorithm

Floyd–Warshall is a dynamic-programming algorithm. `D⁽ᵏ⁾[i][j]` is the cheapest cost from city *i* to city *j* when only cities 1…k may be used as stops in between.

```
D⁽⁰⁾[i][j] = cost[i][j]        (0 when i = j, ∞ when there is no direct road)
D⁽ᵏ⁾[i][j] = min( D⁽ᵏ⁻¹⁾[i][j],  D⁽ᵏ⁻¹⁾[i][k] + D⁽ᵏ⁻¹⁾[k][j] )
```

1. Initialise `dist` from the cost matrix and set the diagonal to 0.
2. Keep a `next` matrix: `next[i][j]` is the first city to visit after *i* on the way to *j*.
3. For every intermediate city *k*, update `dist[i][j]` whenever `i → k → j` is cheaper, and set `next[i][j] = next[i][k]`.
4. Optionally display the matrix after chosen stages.
5. Answer pair queries and rebuild routes by following `next`.
6. After the last stage, any `dist[i][i] < 0` means a **negative cycle**. Pairs whose route can pass through that cycle have no cheapest cost (−∞).

| Complexity | |
| --- | --- |
| Time | Θ(n³) |
| Space | Θ(n²) |

---

## Repository structure

```
FareGrid/
├── console/
│   └── floyd_warshall.c   Menu-driven console program (the C deliverable)
├── engine/
│   ├── floyd_core.c       Same algorithm, no C library, compiled to WebAssembly
│   └── build.sh           Builds public/floyd.wasm
├── public/                Static web app (deployed by Vercel)
│   ├── index.html
│   ├── styles.css
│   ├── app.js             UI: network editor, step player, route planner, insights
│   ├── engine.js          Loads floyd.wasm and calls the C functions
│   └── floyd.wasm         Compiled C engine (≈6 KB)
├── vercel.json
└── README.md
```

---

## 1. Console program (C)

```bash
cd console
gcc -Wall -std=c99 -o floyd_warshall floyd_warshall.c
./floyd_warshall
```

**Menu**

| Option | Action |
| --- | --- |
| 1 | Enter cities and cost matrix (`INF`, `x` or `-` = no road; negative costs allowed) |
| 2 | Load a sample dataset |
| 3 | Display cities and input cost matrix |
| 4 | Run Floyd–Warshall (no trace / every stage / selected stages) |
| 5 | Display final distance matrix |
| 6 | Display next-hop (route) matrix |
| 7 | Query cheapest cost and route (repeated queries) |
| 8 | List unreachable city pairs |
| 9 | Negative-cycle report |
| 10 | Analysis summary (checks, updates, complexity) |
| 0 | Exit |

**Sample datasets**

1. **Maharashtra & Goa**: positive road costs between Mumbai, Pune, Nashik, Nagpur and Goa.
2. **Gujarat discounts**: negative edges without a negative cycle (the CLRS textbook example).
3. **North India loop**: a negative cycle (Delhi → Agra → Jaipur → Delhi = −1), plus unreachable cities.

---

## 2. Web app

The web app runs the **same C algorithm** compiled to WebAssembly, so it needs no server or database. It is a static site.

| Section | What it shows |
| --- | --- |
| **Network** | Load a sample, generate a random network, or build your own cities and cost matrix. Drag cities on the map. |
| **Visualize** | Steps through the algorithm one improvement or one stage at a time. Highlights the intermediate city *k*, the cells being compared, and the `min( … )` calculation with real numbers. |
| **Route planner** | Cheapest cost and route between any two cities, with an animated path on the map, the saving over the direct road, and a heatmap of all city pairs. |
| **Insights** | Relaxation checks against the n³ bound, improvements per stage, the negative-cycle check, unreachable pairs and the next-hop matrix. |

Dark and light themes · works on phones · respects reduced-motion settings.

### Run locally

WebAssembly must be served over HTTP, not opened as a file:

```bash
cd public
python3 -m http.server 8000
# open http://localhost:8000
```

### Deploy on Vercel

1. Import this repository in Vercel.
2. Leave the framework preset as **Other**. No build command is needed.
3. Deploy. `vercel.json` sets `public/` as the output directory.

### Rebuild the WebAssembly engine (only after editing `engine/floyd_core.c`)

```bash
pip install ziglang      # or install zig / LLVM clang with wasm-ld
./engine/build.sh        # writes public/floyd.wasm
```

---

## Testing

- The console program and the WebAssembly engine give identical results. They were checked against the native C engine on 400 random networks, including 156 with negative cycles.
- The textbook CLRS 5-vertex example gives the expected final matrix.
- Edge cases covered: a single city, unreachable pairs, negative edges, negative cycles, invalid input, and querying before the algorithm has run.

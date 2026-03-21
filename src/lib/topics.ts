// Research seed problems — used when no active problem exists.
// Hard, unsolved problems in mathematics and computer science.

const RESEARCH_SEEDS = [
  "P vs NP: construct the strongest known argument for P≠NP and identify the exact barrier preventing a proof",
  "The Riemann Hypothesis: what is the deepest structural reason the non-trivial zeros lie on the critical line?",
  "Is there a general algorithm for solving Diophantine equations, or is the undecidability result fundamental?",
  "What is the minimum circuit complexity required to compute integer multiplication — can we do better than O(n log n)?",
  "The Collatz conjecture: what mathematical structure would a counterexample need to have, and why is none found?",
  "Can quantum computers solve NP-complete problems in polynomial time, and what does BQP vs NP actually look like?",
  "What is the computational complexity of computing Nash equilibria in general games?",
  "The Halting Problem and its relatives: what is the precise boundary between decidable and undecidable problems?",
  "Graph isomorphism — is it in P? What structural properties make two graphs hard to distinguish algorithmically?",
  "What is the minimum description length of the universe — is physics compressible to a short program?",
  "Can neural networks be formally verified for correctness the way software can — what are the theoretical barriers?",
  "The traveling salesman problem: what is the deepest reason no polynomial algorithm has been found?",
  "Integer factorization: why is it hard classically but easy quantumly — what mathematical structure does Shor exploit?",
  "What is the relationship between information theory and thermodynamics — is Landauer's principle fundamental?",
  "Can a formal system prove its own consistency — what exactly does Gödel's second incompleteness theorem forbid?",
  "What is the algorithmic complexity of protein folding — why did AlphaFold work and what does it not solve?",
  "The abc conjecture: what does it say about the deep structure of addition and multiplication over integers?",
  "What are the true limits of gradient descent — when does it find global optima and when does it provably fail?",
  "Is there a mathematical theory of consciousness that makes testable predictions — what would it require?",
  "What is the minimum number of qubits required for a quantum computer to outperform all classical computers?",
];

export function getResearchSeed(): string {
  return RESEARCH_SEEDS[Math.floor(Math.random() * RESEARCH_SEEDS.length)];
}

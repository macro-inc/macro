export const boxSdf = `
  float box(vec2 position, vec2 halfSize, float cornerRadius) {
      position = abs(position) - halfSize + cornerRadius;
      return length(max(position, 0.0)) + min(max(position.x, position.y), 0.0) - cornerRadius;
  }
`;

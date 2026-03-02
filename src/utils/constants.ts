export const propertyRentData: Record<number, { rent: number; houseRents: number[]; hotelRent: number; color: string; originalPrice: number }> = {
  // Brown properties
  1: { rent: 4, houseRents: [20, 60, 180, 320], hotelRent: 450, color: "#955436", originalPrice: 60 },
  3: { rent: 6, houseRents: [30, 90, 270, 400], hotelRent: 550, color: "#955436", originalPrice: 80 },
  // Light Blue properties
  6: { rent: 8, houseRents: [40, 100, 300, 450], hotelRent: 600, color: "#AAE0FA", originalPrice: 100 },
  8: { rent: 8, houseRents: [40, 100, 300, 450], hotelRent: 600, color: "#AAE0FA", originalPrice: 100 },
  9: { rent: 10, houseRents: [50, 150, 450, 625], hotelRent: 750, color: "#AAE0FA", originalPrice: 120 },
  // Pink properties
  11: { rent: 12, houseRents: [60, 180, 500, 700], hotelRent: 900, color: "#D93A96", originalPrice: 140 },
  13: { rent: 12, houseRents: [60, 180, 500, 700], hotelRent: 900, color: "#D93A96", originalPrice: 140 },
  14: { rent: 14, houseRents: [70, 200, 550, 750], hotelRent: 950, color: "#D93A96", originalPrice: 160 },
  // Orange properties
  16: { rent: 14, houseRents: [70, 200, 550, 750], hotelRent: 950, color: "#F7941D", originalPrice: 180 },
  18: { rent: 14, houseRents: [70, 200, 550, 750], hotelRent: 950, color: "#F7941D", originalPrice: 180 },
  19: { rent: 16, houseRents: [80, 220, 600, 800], hotelRent: 1000, color: "#F7941D", originalPrice: 200 },
  // Red properties
  21: { rent: 18, houseRents: [90, 250, 700, 875], hotelRent: 1050, color: "#ED1B24", originalPrice: 220 },
  23: { rent: 18, houseRents: [90, 250, 700, 875], hotelRent: 1050, color: "#ED1B24", originalPrice: 220 },
  24: { rent: 20, houseRents: [100, 300, 750, 925], hotelRent: 1100, color: "#ED1B24", originalPrice: 240 },
  // Yellow properties
  26: { rent: 22, houseRents: [110, 330, 800, 975], hotelRent: 1150, color: "#FEF200", originalPrice: 260 },
  27: { rent: 22, houseRents: [110, 330, 800, 975], hotelRent: 1150, color: "#FEF200", originalPrice: 260 },
  29: { rent: 24, houseRents: [120, 360, 850, 1025], hotelRent: 1200, color: "#FEF200", originalPrice: 280 },
  // Green properties
  31: { rent: 26, houseRents: [130, 390, 900, 1100], hotelRent: 1275, color: "#1FB25A", originalPrice: 300 },
  32: { rent: 26, houseRents: [130, 390, 900, 1100], hotelRent: 1275, color: "#1FB25A", originalPrice: 300 },
  34: { rent: 28, houseRents: [150, 450, 1000, 1200], hotelRent: 1400, color: "#1FB25A", originalPrice: 320 },
  // Dark Blue properties
  37: { rent: 35, houseRents: [175, 500, 1100, 1300], hotelRent: 1500, color: "#0072BB", originalPrice: 350 },
  39: { rent: 50, houseRents: [200, 600, 1400, 1700], hotelRent: 2000, color: "#0072BB", originalPrice: 400 },
  // Railroads
  5: { rent: 25, houseRents: [25, 25, 25, 25], hotelRent: 25, color: "rail", originalPrice: 200 },
  15: { rent: 25, houseRents: [25, 25, 25, 25], hotelRent: 25, color: "rail", originalPrice: 200 },
  25: { rent: 25, houseRents: [25, 25, 25, 25], hotelRent: 25, color: "rail", originalPrice: 200 },
  35: { rent: 25, houseRents: [25, 25, 25, 25], hotelRent: 25, color: "rail", originalPrice: 200 },
  // Utilities
  12: { rent: 0, houseRents: [0, 0, 0, 0], hotelRent: 0, color: "utility", originalPrice: 150 }, // Electric
  28: { rent: 0, houseRents: [0, 0, 0, 0], hotelRent: 0, color: "utility", originalPrice: 150 }, // Water
};

// Color groups for monopoly check
export const colorGroups: Record<string, number[]> = {
  "#955436": [1, 3], // Brown
  "#AAE0FA": [6, 8, 9], // Light Blue
  "#D93A96": [11, 13, 14], // Pink
  "#F7941D": [16, 18, 19], // Orange
  "#ED1B24": [21, 23, 24], // Red
  "#FEF200": [26, 27, 29], // Yellow
  "#1FB25A": [31, 32, 34], // Green
  "#0072BB": [37, 39], // Dark Blue
  "rail": [5, 15, 25, 35], // Railroads
  "utility": [12, 28], // Utilities
};

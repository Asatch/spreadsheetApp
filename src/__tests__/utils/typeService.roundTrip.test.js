import { TypeService, TYPE_HIERARCHY } from '../../utils/typeService';

describe('TypeService Round Trip Tests', () => {
  describe('Number Round Trip (Canonical Format Re-interpretation)', () => {
    test('should maintain number type when canonical format is re-submitted', () => {
      // Test case: user enters 123456.78912
      const originalInput = '123456.78912';
      
      // Step 1: Initial type detection - should detect as NUMBER
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(initialDetection.value).toBe(123456.78912);
      
      // Step 2: Format as canonical (what shows in formula bar)
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.NUMBER);
      expect(canonicalFormat).toBe('123 456.789 12'); // Canonical format with spaces
      
      // Step 3: Re-submit the canonical format (what happens when user edits from formula bar)
      // This should now work correctly - canonical format should be re-interpreted as NUMBER
      const reDetection = TypeService.detectType(canonicalFormat);
      
      // This should PASS but currently FAILS
      expect(reDetection.type).toBe(TYPE_HIERARCHY.NUMBER); 
      expect(reDetection.value).toBe(123456.78912);
    });

    test('should handle round trip for large numbers with spaces', () => {
      const originalInput = '1234567890123';
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      
      // Format as canonical 
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.NUMBER);
      // Should be in scientific notation: "1.234 567 890 123e+12"
      
      // Re-submit canonical format
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(reDetection.value).toBe(1234567890123);
    });

    test('should handle round trip for numbers with thousands separators', () => {
      const originalInput = '12345.67';
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      
      // Format as canonical
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.NUMBER);
      expect(canonicalFormat).toBe('12 345.67'); // Should have space separator
      
      // Re-submit canonical format - this should still be detected as NUMBER
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(reDetection.value).toBe(12345.67);
    });

    test('should handle round trip for negative numbers with spaces', () => {
      const originalInput = '-987654.321';
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      
      // Format as canonical
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.NUMBER);
      expect(canonicalFormat).toBe('-987 654.321'); // Should have space separator
      
      // Re-submit canonical format
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(reDetection.value).toBe(-987654.321);
    });

    test('should handle round trip for scientific notation', () => {
      const originalInput = '1.23e5';
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(initialDetection.value).toBe(123000);
      
      // Format as canonical
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.NUMBER);
      expect(canonicalFormat).toBe('123 000'); // Should format as decimal with spaces
      
      // Re-submit canonical format
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(reDetection.value).toBe(123000);
    });

    test('should handle round trip for very large numbers in scientific notation', () => {
      const originalInput = '1000000000000'; // 1 trillion
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      
      // Format as canonical (should be scientific notation)
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.NUMBER);
      expect(canonicalFormat).toBe('1e+12'); // Should be in scientific notation
      
      // Re-submit canonical format
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(reDetection.value).toBe(1000000000000);
    });
  });

  describe('Text Round Trip (should maintain single quote)', () => {
    test('should maintain text type when canonical format is re-submitted', () => {
      const originalInput = "'123456"; // Explicit text
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(initialDetection.value).toBe('123456');
      
      // Format as canonical
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.TEXT);
      expect(canonicalFormat).toBe("'123456"); // Should have leading quote
      
      // Re-submit canonical format
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(reDetection.value).toBe('123456');
    });
  });

  describe('Date Round Trip', () => {
    test('should maintain date type when canonical format is re-submitted', () => {
      const originalInput = '2023-10-15';
      
      // Initial detection
      const initialDetection = TypeService.detectType(originalInput);
      expect(initialDetection.type).toBe(TYPE_HIERARCHY.DATE);
      
      // Format as canonical
      const canonicalFormat = TypeService.formatCanonical(initialDetection.value, TYPE_HIERARCHY.DATE);
      expect(canonicalFormat).toBe('2023-10-15'); // Should be same format
      
      // Re-submit canonical format
      const reDetection = TypeService.detectType(canonicalFormat);
      expect(reDetection.type).toBe(TYPE_HIERARCHY.DATE);
      expect(reDetection.value).toBe(initialDetection.value);
    });
  });
});
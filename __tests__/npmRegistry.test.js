'use strict'

const NpmRegistry = require('../lib/helpers/npmRegistry')
const crypto = require('node:crypto')

// Mock external dependencies
jest.mock('sigstore', () => ({
  verify: jest.fn()
}))

jest.mock('npm-package-arg', () => {
  const actualNpa = jest.requireActual('npm-package-arg')
  return Object.assign(
    (spec) => {
      const result = actualNpa(spec)
      // Handle the case where no version is specified, so it should default to latest
      if (spec === 'express' && result.fetchSpec === '*') {
        result.fetchSpec = 'latest'
      }
      return result
    },
    actualNpa,
    {
      toPurl: jest.fn().mockReturnValue('pkg:npm/express@1.0.0')
    }
  )
})

jest.mock('ssri', () => ({
  parse: jest.fn().mockReturnValue({
    hexDigest: () => 'deadbeef'
  })
}))

// Mock fetch globally
global.fetch = jest.fn()

describe('NpmRegistry', () => {
  let npmRegistry

  beforeEach(() => {
    jest.clearAllMocks()
    npmRegistry = new NpmRegistry()
  })

  describe('Constructor', () => {
    test('should create instance with default registry', () => {
      const registry = new NpmRegistry()
      expect(registry.registry).toBe('https://registry.npmjs.org')
      expect(registry.opts).toEqual({})
    })

    test('should create instance with custom registry', () => {
      const customRegistry = 'https://custom.registry.com'
      const registry = new NpmRegistry({ registry: customRegistry })
      expect(registry.registry).toBe(customRegistry)
      expect(registry.opts).toEqual({ registry: customRegistry })
    })

    test('should store additional options', () => {
      const opts = { registry: 'https://custom.com', timeout: 5000 }
      const registry = new NpmRegistry(opts)
      expect(registry.opts).toEqual(opts)
    })
  })

  describe('getManifest', () => {
    test('should fetch package manifest successfully', async () => {
      const mockPackument = {
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'express',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/express/-/express-1.0.0.tgz',
              integrity: 'sha512-example'
            }
          }
        },
        time: {
          '1.0.0': '2023-01-01T00:00:00.000Z'
        }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      const manifest = await npmRegistry.getManifest('express@1.0.0')

      expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/express', {
        headers: {
          accept: 'application/json',
          'user-agent': 'npq-npm-registry-client'
        }
      })
      expect(manifest.name).toBe('express')
      expect(manifest.version).toBe('1.0.0')
      expect(manifest._time).toBe('2023-01-01T00:00:00.000Z')
    })

    test('should handle latest tag when no version specified', async () => {
      const mockPackument = {
        'dist-tags': { latest: '2.0.0' },
        versions: {
          '2.0.0': {
            name: 'express',
            version: '2.0.0'
          }
        }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      const manifest = await npmRegistry.getManifest('express')
      expect(manifest.version).toBe('2.0.0')
    })

    test('should handle explicit latest tag', async () => {
      const mockPackument = {
        'dist-tags': { latest: '3.0.0' },
        versions: {
          '3.0.0': {
            name: 'express',
            version: '3.0.0'
          }
        }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      const manifest = await npmRegistry.getManifest('express@latest')
      expect(manifest.version).toBe('3.0.0')
    })

    test('should pass custom headers', async () => {
      const mockPackument = {
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { name: 'express', version: '1.0.0' }
        }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      await npmRegistry.getManifest('express', {
        headers: { authorization: 'Bearer token' }
      })

      expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/express', {
        headers: {
          accept: 'application/json',
          'user-agent': 'npq-npm-registry-client',
          authorization: 'Bearer token'
        }
      })
    })

    test('should handle fetch failure', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })

      await expect(npmRegistry.getManifest('nonexistent')).rejects.toThrow(
        'Failed to fetch package manifest: 404 Not Found'
      )
    })

    test('should handle missing version', async () => {
      const mockPackument = {
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { name: 'express', version: '1.0.0' }
        }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      await expect(npmRegistry.getManifest('express@2.0.0')).rejects.toThrow(
        'Version 2.0.0 not found for package express'
      )
    })

    test('should handle missing versions object', async () => {
      const mockPackument = {
        'dist-tags': { latest: '1.0.0' }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      await expect(npmRegistry.getManifest('express@1.0.0')).rejects.toThrow(
        'Version 1.0.0 not found for package express'
      )
    })

    test('should handle missing time information gracefully', async () => {
      const mockPackument = {
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'express',
            version: '1.0.0'
          }
        }
        // No time field
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      const manifest = await npmRegistry.getManifest('express@1.0.0')
      expect(manifest._time).toBeUndefined()
    })

    test('should handle scoped packages', async () => {
      const mockPackument = {
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: '@scope/package',
            version: '1.0.0'
          }
        }
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPackument)
      })

      await npmRegistry.getManifest('@scope/package@1.0.0')

      expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/@scope%2fpackage', {
        headers: {
          accept: 'application/json',
          'user-agent': 'npq-npm-registry-client'
        }
      })
    })
  })

  describe('verifySignatures', () => {
    let mockManifest
    let mockRegistryKeys

    beforeEach(() => {
      mockManifest = {
        _id: 'express@1.0.0',
        name: 'express',
        version: '1.0.0',
        _time: '2023-01-01T00:00:00.000Z',
        dist: {
          tarball: 'https://registry.npmjs.org/express/-/express-1.0.0.tgz',
          integrity: 'sha512-example',
          signatures: [
            {
              keyid: 'key1',
              sig: 'signature1'
            }
          ]
        }
      }

      mockRegistryKeys = [
        {
          keyid: 'key1',
          pemkey:
            '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----',
          expires: '2025-01-01T00:00:00.000Z'
        }
      ]
    })

    test('should verify signatures successfully', async () => {
      // Mock crypto.createVerify
      const mockVerifier = {
        write: jest.fn(),
        end: jest.fn(),
        verify: jest.fn().mockReturnValue(true)
      }
      jest.spyOn(crypto, 'createVerify').mockReturnValue(mockVerifier)

      const result = await npmRegistry.verifySignatures(mockManifest, mockRegistryKeys)

      expect(crypto.createVerify).toHaveBeenCalledWith('SHA256')
      expect(mockVerifier.write).toHaveBeenCalledWith('express@1.0.0:sha512-example')
      expect(mockVerifier.end).toHaveBeenCalled()
      expect(mockVerifier.verify).toHaveBeenCalledWith(
        mockRegistryKeys[0].pemkey,
        'signature1',
        'base64'
      )
      expect(result._signatures).toEqual(mockManifest.dist.signatures)
    })

    test('should throw error when no signatures exist', async () => {
      const manifestWithoutSigs = { ...mockManifest }
      delete manifestWithoutSigs.dist.signatures

      await expect(
        npmRegistry.verifySignatures(manifestWithoutSigs, mockRegistryKeys)
      ).rejects.toThrow('Package has no signatures to verify')
    })

    test('should throw error when public key not found', async () => {
      const manifestWithDifferentKey = {
        ...mockManifest,
        dist: {
          ...mockManifest.dist,
          signatures: [{ keyid: 'unknown-key', sig: 'signature' }]
        }
      }

      await expect(
        npmRegistry.verifySignatures(manifestWithDifferentKey, mockRegistryKeys)
      ).rejects.toThrow(
        /has a registry signature with keyid: unknown-key but no corresponding public key can be found/
      )
    })

    test('should throw error when public key is expired', async () => {
      const expiredKeys = [
        {
          ...mockRegistryKeys[0],
          expires: '2020-01-01T00:00:00.000Z' // Expired before publish time
        }
      ]

      await expect(npmRegistry.verifySignatures(mockManifest, expiredKeys)).rejects.toThrow(
        /has a registry signature with keyid: key1 but the corresponding public key has expired/
      )
    })

    test('should handle missing time with cutoff date', async () => {
      const manifestWithoutTime = { ...mockManifest }
      delete manifestWithoutTime._time

      const mockVerifier = {
        write: jest.fn(),
        end: jest.fn(),
        verify: jest.fn().mockReturnValue(true)
      }
      jest.spyOn(crypto, 'createVerify').mockReturnValue(mockVerifier)

      const result = await npmRegistry.verifySignatures(manifestWithoutTime, mockRegistryKeys)
      expect(result._signatures).toEqual(mockManifest.dist.signatures)
    })

    test('should throw error when signature verification fails', async () => {
      const mockVerifier = {
        write: jest.fn(),
        end: jest.fn(),
        verify: jest.fn().mockReturnValue(false) // Invalid signature
      }
      jest.spyOn(crypto, 'createVerify').mockReturnValue(mockVerifier)

      await expect(npmRegistry.verifySignatures(mockManifest, mockRegistryKeys)).rejects.toThrow(
        /has an invalid registry signature/
      )
    })

    test('should handle public key without expiration', async () => {
      const keysWithoutExpiration = [
        {
          ...mockRegistryKeys[0]
        }
      ]
      delete keysWithoutExpiration[0].expires

      const mockVerifier = {
        write: jest.fn(),
        end: jest.fn(),
        verify: jest.fn().mockReturnValue(true)
      }
      jest.spyOn(crypto, 'createVerify').mockReturnValue(mockVerifier)

      const result = await npmRegistry.verifySignatures(mockManifest, keysWithoutExpiration)
      expect(result._signatures).toEqual(mockManifest.dist.signatures)
    })

    test('should handle multiple signatures', async () => {
      const manifestWithMultipleSigs = {
        ...mockManifest,
        dist: {
          ...mockManifest.dist,
          signatures: [
            { keyid: 'key1', sig: 'sig1' },
            { keyid: 'key2', sig: 'sig2' }
          ]
        }
      }

      const multipleKeys = [
        mockRegistryKeys[0],
        {
          keyid: 'key2',
          pemkey: '-----BEGIN PUBLIC KEY-----\nDifferentKey...\n-----END PUBLIC KEY-----'
        }
      ]

      const mockVerifier = {
        write: jest.fn(),
        end: jest.fn(),
        verify: jest.fn().mockReturnValue(true)
      }
      jest.spyOn(crypto, 'createVerify').mockReturnValue(mockVerifier)

      const result = await npmRegistry.verifySignatures(manifestWithMultipleSigs, multipleKeys)
      expect(result._signatures).toEqual(manifestWithMultipleSigs.dist.signatures)
      expect(crypto.createVerify).toHaveBeenCalledTimes(2)
    })
  })

  describe('verifyAttestations', () => {
    let mockManifest
    let mockRegistryKeys
    const sigstore = require('sigstore')

    beforeEach(() => {
      mockManifest = {
        _id: 'express@1.0.0',
        name: 'express',
        version: '1.0.0',
        dist: {
          tarball: 'https://registry.npmjs.org/express/-/express-1.0.0.tgz',
          integrity: 'sha512-example',
          attestations: {
            url: 'http://registry.npmjs.org/-/npm/v1/attestations/express@1.0.0'
          }
        }
      }

      mockRegistryKeys = [
        {
          keyid: 'key1',
          pemkey:
            '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----'
        }
      ]
    })

    test('should throw error when no attestations exist', async () => {
      const manifestWithoutAttestations = { ...mockManifest }
      delete manifestWithoutAttestations.dist.attestations

      await expect(
        npmRegistry.verifyAttestations(manifestWithoutAttestations, mockRegistryKeys)
      ).rejects.toThrow('Package has no attestations to verify')
    })

    test('should fetch and verify attestations successfully', async () => {
      // Mock the statement payload with matching hex digest
      const correctHexDigest = require('ssri').parse(mockManifest.dist.integrity).hexDigest()
      const statement = {
        subject: [
          {
            name: 'pkg:npm/express@1.0.0',
            digest: {
              sha512: correctHexDigest
            }
          }
        ]
      }

      const mockAttestations = {
        attestations: [
          {
            predicateType: 'https://slsa.dev/provenance/v0.2',
            bundle: {
              dsseEnvelope: {
                payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
                signatures: [
                  {
                    keyid: 'key1',
                    sig: 'signature1'
                  }
                ]
              },
              verificationMaterial: {
                tlogEntries: [
                  {
                    integratedTime: '1640995200' // 2022-01-01
                  }
                ]
              }
            }
          }
        ]
      }

      // Mock fetch for attestations
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAttestations)
      })

      // Mock sigstore verification
      sigstore.verify.mockResolvedValue()

      const result = await npmRegistry.verifyAttestations(mockManifest, mockRegistryKeys)

      expect(fetch).toHaveBeenCalledWith(
        'https://registry.npmjs.org/-/npm/v1/attestations/express@1.0.0',
        {
          headers: {
            accept: 'application/json',
            'user-agent': 'npq-npm-registry-client'
          }
        }
      )
      expect(result._attestations).toEqual(mockManifest.dist.attestations)
    })

    test('should handle fetch failure for attestations', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })

      await expect(npmRegistry.verifyAttestations(mockManifest, mockRegistryKeys)).rejects.toThrow(
        'Failed to fetch attestations: 404 Not Found'
      )
    })

    test('should throw error when no corresponding public key found', async () => {
      const mockAttestations = {
        attestations: [
          {
            predicateType: 'https://slsa.dev/provenance/v0.2',
            bundle: {
              dsseEnvelope: {
                payload: Buffer.from(JSON.stringify({})).toString('base64'),
                signatures: [
                  {
                    keyid: 'unknown-key',
                    sig: 'signature1'
                  }
                ]
              }
            }
          }
        ]
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAttestations)
      })

      await expect(npmRegistry.verifyAttestations(mockManifest, [])).rejects.toThrow(
        /has attestations but no corresponding public key\(s\) can be found/
      )
    })

    test('should handle attestation verification failure', async () => {
      // Mock the statement payload with matching hex digest
      const correctHexDigest = require('ssri').parse(mockManifest.dist.integrity).hexDigest()
      const statement = {
        subject: [
          {
            name: 'pkg:npm/express@1.0.0',
            digest: { sha512: correctHexDigest }
          }
        ]
      }

      const mockAttestations = {
        attestations: [
          {
            predicateType: 'https://slsa.dev/provenance/v0.2',
            bundle: {
              dsseEnvelope: {
                payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
                signatures: [
                  {
                    keyid: 'key1',
                    sig: 'signature1'
                  }
                ]
              },
              verificationMaterial: {
                tlogEntries: [{ integratedTime: '1640995200' }]
              }
            }
          }
        ]
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAttestations)
      })

      // Mock sigstore verification failure
      sigstore.verify.mockRejectedValue(new Error('Verification failed'))

      await expect(npmRegistry.verifyAttestations(mockManifest, mockRegistryKeys)).rejects.toThrow(
        /failed to verify attestation: Verification failed/
      )
    })
  })
})

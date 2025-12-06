'use strict'

/**
 * Author Marshall - Package Publisher Security Checks
 *
 * This marshall performs two distinct security checks related to package publishing:
 *
 * 1. NEW AUTHOR CHECK (lines 65-80)
 *    Detects if this is the first version ever published by this user for this package.
 *    - Condition: No prior versions exist from this user, OR the current version is their first.
 *    - Only flags if the version was published recently (≤21 days ago).
 *    - Rationale: A brand new publisher on an established package could indicate account
 *      compromise or malicious takeover. However, if the "first" version is old (e.g., 10 years),
 *      it's not a current risk.
 *
 * 2. VERSION RECENCY CHECK (lines 91-106)
 *    Detects if the current version being installed was published very recently.
 *    - ≤7 days: Throws an Error (high risk)
 *    - ≤30 days: Throws a Warning (moderate risk)
 *    - Only applies if version is ≤45 days old.
 *    - Rationale: Very recently published versions haven't had time for community review
 *      and could contain undiscovered malicious code. This is independent of author history.
 *
 * These two checks are complementary:
 * - Check 1 focuses on WHO published (author trustworthiness)
 * - Check 2 focuses on WHEN it was published (version maturity)
 */

const BaseMarshall = require('./baseMarshall')
const Warning = require('../helpers/warning')
const { marshallCategories } = require('./constants')

const MARSHALL_NAME = 'author'

class Marshall extends BaseMarshall {
  constructor(options) {
    super(options)
    this.name = MARSHALL_NAME
    this.categoryId = marshallCategories.SupplyChainSecurity.id
  }

  title() {
    return 'Identifying package author...'
  }

  /**
   * Validates package author and version recency for security risks.
   *
   * Performs two checks:
   * 1. New Author Check: Flags if this is the user's first publish of this package
   *    AND the version was published within the last 21 days.
   * 2. Version Recency Check: Flags recently published versions regardless of author:
   *    - Error if ≤7 days old
   *    - Warning if ≤30 days old
   *
   * @param {Object} pkg - Package info with packageName and packageVersion
   * @returns {string} The version's publish date string if all checks pass
   * @throws {Error} If security risk is detected (new author or very recent version)
   * @throws {Warning} If moderate risk is detected (version 8-30 days old)
   */
  async validate(pkg) {
    // @TODO move some of these utility functions about first package version
    // published, date diff, etc into the package repo utils
    const pakument = await this.packageRepoUtils.getPackageInfo(pkg.packageName)

    const packageVersion = await this.packageRepoUtils.getSemVer(
      pkg.packageName,
      pkg.packageVersion
    )

    // @TODO fix to work for both explicit versions (1.0.0) and also
    // for dist-tags (latest)
    const npmUser = pakument.versions[packageVersion]._npmUser
    if (!npmUser || !npmUser.email) {
      throw new Error('Could not determine publishing user for this package version')
    }

    // Agree with Colin on keeping email regex simple: https://colinhacks.com/essays/reasonable-email-regex
    const emailRegex =
      /^(?!\.)(?!.*\.\.)([a-z0-9_'+\-.]*)[a-z0-9_'+-]@([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/i
    if (!emailRegex.test(npmUser.email)) {
      throw new Error('The publishing user has no valid email address')
    }

    let firstVersionForUser = null
    const versionPublishedDateString = pakument.time[packageVersion]
    for (const versionMetadata of Object.values(pakument.versions)) {
      if (versionMetadata._npmUser && versionMetadata._npmUser.email === npmUser.email) {
        firstVersionForUser = versionMetadata
        break
      }
    }

    if (!firstVersionForUser || firstVersionForUser.version === packageVersion) {
      // Only throw the error if also the `packageVersion` was published less than 21 days ago:
      if (versionPublishedDateString) {
        const dateDiffInMs = new Date() - new Date(versionPublishedDateString)
        let dateDiffInDays = 0

        if (dateDiffInMs > 0) {
          dateDiffInDays = Math.round(dateDiffInMs / (1000 * 60 * 60 * 24))
        }

        if (dateDiffInDays <= 21) {
          throw new Error(
            `The user ${npmUser.name} <${npmUser.email}> published this package for the first time only ${dateDiffInDays} days ago`
          )
        }
      }

      // otherwise, there's no point in throwing an error
      // because this version already exists for a while. for e.g: package `ncp` latest version
      // is from 10 years ago which was the first version published by the user, but that's
      // hardly a risk at this point being 10 years old, so we don't throw the following error:
      // throw new Error(
      //   `This is the first version the user ${npmUser.name} <${npmUser.email}> published this package`
      // )
    }

    // get date in ms
    const dateDiffInMsVersionPublished = new Date() - new Date(versionPublishedDateString)
    let dateDiffVersionPublished = 0
    if (dateDiffInMsVersionPublished > 0) {
      dateDiffVersionPublished = Math.round(dateDiffInMsVersionPublished / (1000 * 60 * 60 * 24))
    }

    if (dateDiffVersionPublished <= 45) {
      if (dateDiffVersionPublished <= 7) {
        throw new Error(
          `This version was published only ${dateDiffVersionPublished} days ago by ${npmUser.name} <${npmUser.email}>`
        )
      }

      if (dateDiffVersionPublished <= 30) {
        throw new Warning(
          `This version was published only ${dateDiffVersionPublished} days ago by ${npmUser.name} <${npmUser.email}>`
        )
      }
    }

    return versionPublishedDateString
  }
}

module.exports = Marshall

/*
 *
 *    Copyright (c) 2021 Project CHIP Authors
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

// Import helpers from zap core
const string = require('../../../../../../util/string');
const templateUtil = require('../../../../../../generator/template-util');
const zclHelper = require('../../../../../../generator/helper-zcl.js');

const ChipTypesHelper = require('../../../../app/zap-templates/common/ChipTypesHelper');
const TestHelper = require('../../../../app/zap-templates/common/ClusterTestGeneration.js');
const StringHelper = require('../../../../app/zap-templates/common/StringHelper.js');
const appHelper = require('../../../../app/zap-templates/templates/app/helper.js');
const dbEnum = require('../../../../../../../src-shared/db-enum');

function asObjectiveCBasicType(type, options) {
  if (StringHelper.isOctetString(type)) {
    return options.hash.is_mutable ? 'NSMutableData *' : 'NSData *';
  } else if (StringHelper.isCharString(type)) {
    return options.hash.is_mutable ? 'NSMutableString *' : 'NSString *';
  } else {
    return ChipTypesHelper.asBasicType(this.chipType);
  }
}

/**
 * Converts an expression involving possible variables whose types are objective C objects into an expression whose type is a C++
 * type
 */
async function asTypedExpressionFromObjectiveC(value, type) {
  const valueIsANumber = !isNaN(value);
  if (!value || valueIsANumber) {
    return appHelper.asTypedLiteral.call(this, value, type);
  }

  const tokens = value.split(' ');
  if (tokens.length < 2) {
    return appHelper.asTypedLiteral.call(this, value, type);
  }

  let expr = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['+', '-', '/', '*', '%', '(', ')'].includes(token)) {
      expr[i] = token;
    } else if (!isNaN(token.replace(/ULL$|UL$|U$|LL$|L$/i, ''))) {
      expr[i] = await appHelper.asTypedLiteral.call(this, token, type);
    } else {
      const variableType = TestHelper.chip_tests_variables_get_type.call(
        this,
        token
      );
      const asType = await asObjectiveCNumberType.call(
        this,
        token,
        variableType,
        true
      );
      expr[i] = `[${token} ${asType}Value]`;
    }
  }

  return expr.join(' ');
}

function asObjectiveCNumberType(label, type, asLowerCased) {
  function fn(pkgId) {
    const options = { hash: {} };
    return zclHelper.asUnderlyingZclType
      .call(this, type, options)
      .then((zclType) => {
        const basicType = ChipTypesHelper.asBasicType(zclType);
        switch (basicType) {
          case 'bool':
            return 'Bool';
          case 'uint8_t':
            return 'UnsignedChar';
          case 'uint16_t':
            return 'UnsignedShort';
          case 'uint32_t':
            return 'UnsignedInt';
          case 'uint64_t':
            return 'UnsignedLongLong';
          case 'int8_t':
            return 'Char';
          case 'int16_t':
            return 'Short';
          case 'int32_t':
            return 'Int';
          case 'int64_t':
            return 'LongLong';
          case 'float':
            return 'Float';
          case 'double':
            return 'Double';
          default:
            error =
              label +
              ': Unhandled underlying type ' +
              zclType +
              ' for original type ' +
              type;
            throw error;
        }
      })
      .then((typeName) =>
        asLowerCased
          ? typeName[0].toLowerCase() + typeName.substring(1)
          : typeName
      );
  }

  const promise = templateUtil
    .ensureZclPackageIds(this)
    .then(fn.bind(this))
    .catch((err) => console.log(err));
  return templateUtil.templatePromise(this.global, promise);
}

const compatClusterNameMap = {
  UnitTesting: 'TestCluster',
};

function compatClusterNameRemapping(cluster) {
  cluster = appHelper.asUpperCamelCase(cluster, {
    hash: { preserveAcronyms: false },
  });

  if (cluster in compatClusterNameMap) {
    cluster = compatClusterNameMap[cluster];
  }

  return cluster;
}

async function asObjectiveCClass(type, cluster, options) {
  let pkgIds = await templateUtil.ensureZclPackageIds(this);
  let isStruct = await zclHelper
    .isStruct(this.global.db, type, pkgIds)
    .then((zclType) => zclType != 'unknown');

  if (
    (this.isArray || this.entryType || options.hash.forceList) &&
    !options.hash.forceNotList
  ) {
    return 'NSArray';
  }

  if (StringHelper.isOctetString(type)) {
    return 'NSData';
  }

  if (StringHelper.isCharString(type)) {
    return 'NSString';
  }

  if (isStruct) {
    if (options.hash.compatRemapClusterName) {
      cluster = compatClusterNameRemapping.call(this, cluster);
    } else {
      let preserveAcronyms = true;
      if ('preserveAcronyms' in options.hash) {
        preserveAcronyms = options.hash.preserveAcronyms;
      }
      cluster = appHelper.asUpperCamelCase(cluster, {
        hash: { preserveAcronyms: preserveAcronyms },
      });
    }
    return `MTR${cluster}Cluster${appHelper.asUpperCamelCase(type)}`;
  }

  return 'NSNumber';
}

async function asObjectiveCType(type, cluster, options) {
  let typeStr = await asObjectiveCClass.call(this, type, cluster, options);
  if (this.isNullable || this.isOptional) {
    typeStr = `${typeStr} * _Nullable`;
  } else {
    typeStr = `${typeStr} * _Nonnull`;
  }

  return typeStr;
}

function asStructPropertyName(prop) {
  prop = appHelper.asLowerCamelCase(prop);

  // If prop is now "description", we need to rename it, because that's
  // reserved.
  if (prop == 'description') {
    return 'descriptionString';
  }

  // If prop starts with a sequence of capital letters (which can happen for
  // output of asLowerCamelCase if the original string started that way,
  // lowercase all but the last one.
  return prop.replace(/^([A-Z]+)([A-Z])/, (match, p1, p2) => {
    return p1.toLowerCase() + p2;
  });
}

function asGetterName(prop) {
  let propName = asStructPropertyName(prop);
  if (propName.match(/^new[A-Z]/) || propName == 'count') {
    return 'get' + appHelper.asUpperCamelCase(prop);
  }
  return propName;
}

function commandHasRequiredField(command) {
  return command.arguments.some((arg) => !arg.isOptional);
}

/**
 * Produce a reasonable name for an Objective C enum for the given cluster name
 * and enum label.  Because a lot of our enum labels already have the cluster
 * name prefixed (e.g. NetworkCommissioning*, or the IdentifyIdentifyType that
 * has it prefixed _twice_) just concatenating the two gives overly verbose
 * names in a few cases (e.g. "IdentifyIdentifyIdentifyType").
 *
 * This function strips out the redundant cluster names, and strips off trailing
 * "Enum" bits on the enum names while we're here.
 */
function objCEnumName(clusterName, enumLabel, options) {
  clusterName = appHelper.asUpperCamelCase(clusterName, {
    hash: { preserveAcronyms: options.hash.preserveAcronyms },
  });
  enumLabel = appHelper.asUpperCamelCase(enumLabel);
  // Some enum names have one or more copies of the cluster name at the
  // beginning.
  while (enumLabel.startsWith(clusterName)) {
    enumLabel = enumLabel.substring(clusterName.length);
  }

  if (enumLabel.endsWith('Enum')) {
    // Strip that off; it'll clearly be an enum anyway.
    enumLabel = enumLabel.substring(0, enumLabel.length - 'Enum'.length);
  }

  return 'MTR' + clusterName + enumLabel;
}

function objCEnumItemLabel(itemLabel) {
  // Check for the case when we're:
  // 1. A single word (that's the regexp at the beginning, which matches the
  //    word-splitting regexp in string.toCamelCase).
  // 2. All upper-case.
  //
  // This will get converted to lowercase except the first letter by
  // asUpperCamelCase, which is not really what we want.
  if (!/ |_|-|\//.test(itemLabel) && itemLabel.toUpperCase() == itemLabel) {
    return itemLabel.replace(/[.:]/g, '');
  }

  return appHelper.asUpperCamelCase(itemLabel);
}

function hasArguments() {
  return !!this.arguments.length;
}

//
// Module exports
//
exports.asObjectiveCBasicType = asObjectiveCBasicType;
exports.asObjectiveCNumberType = asObjectiveCNumberType;
exports.asObjectiveCClass = asObjectiveCClass;
exports.asObjectiveCType = asObjectiveCType;
exports.asStructPropertyName = asStructPropertyName;
exports.asTypedExpressionFromObjectiveC = asTypedExpressionFromObjectiveC;
exports.asGetterName = asGetterName;
exports.commandHasRequiredField = commandHasRequiredField;
exports.objCEnumName = objCEnumName;
exports.objCEnumItemLabel = objCEnumItemLabel;
exports.hasArguments = hasArguments;
exports.compatClusterNameRemapping = compatClusterNameRemapping;

exports.meta = {
  category: dbEnum.helperCategory.matter,
  alias: ['darwin/Framework/CHIP/templates/helper.js', 'darwin-chip-helper'],
};

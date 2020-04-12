const { exec, execSync } = require('child_process')
const fse = require('fs-extra')
const fs = require('fs')
const inquirer = require('inquirer')

// 判断系统，暂时这样写，不确定准确性
const isOSX = process.platform === 'darwin'
const sslCertificateDir = `${process.env.HOME}/.self-signed-cert`
const sslConfigFile = `${sslCertificateDir}/ssl.cnf`
const sslKeyPath = `${sslCertificateDir}/ssl.key`
const sslCrtPath = `${sslCertificateDir}/ssl.crt`
// 安装到系统上证书的名称
const CN = 'genereted by create-self-signed'
// const CN = 'genereted by ssl-cert-tool@yingchun.fyc'
// const CN = 'self-signed-cert genereted by ssl-cert-tool@yingchun.fyc'
// 自签名证书默认支持的域名
const DEFAULTDOMAINS = [
  'localhost',
  '*.taobao.com',
  '*.alibaba-inc.com',
  '*.alimama.com',
  '*.tanx.com',
  '*.m.taobao.com'
]
const questions = [
  /*
{
    type: 'input',
    name: 'C',
    message: 'Country Name (2 letter code) [CN]',
    default: 'CN'
}, {
    type: 'input',
    name: 'ST',
    message: 'State or Province Name (full name) [ZheJiang]',
    default: 'ZheJiang'
}, {
    type: 'input',
    name: 'L',
    message: 'Locality Name (eg, city) []',
    default: 'HangZhou'
}, {
    type: 'input',
    name: 'O',
    message: 'Organization Name (eg, company) [Internet Widgits Pty Ltd]',
    default: 'Alibaba'
}, {
    type: 'input',
    name: 'OU',
    message: 'Organizational Unit Name (eg, section) []',
    default: 'AlimamaMUX'
},
*/{
    type: 'input',
    name: 'domains',
    // message: 'Input the domain name to be self-signed. Separate multiple domain names with commas',
    message: '输入启动本地HTTPS服务时使用的域名，多个以,分隔，直接回车将使用默认',
    default: DEFAULTDOMAINS.join(',')
  }]

const getInquirerAnswer = async () => {
  const answer = await inquirer.prompt(questions)
  let { domains } = answer
  if (domains) {
    domains = domains.split(',').map(item => item.trim())
  } else {
    domains = []
  }
  let allDomains = DEFAULTDOMAINS.concat(domains)
  // 过滤重复的
  allDomains = allDomains.reduce((accumulator, currentValue) => {
    !accumulator.includes(currentValue) && accumulator.push(currentValue)
    return accumulator
  }, [])
  return {
    ...answer,
    hosts: allDomains
  }
}

const createCnfFile = ({ hosts }) => {
  fs.writeFileSync(sslConfigFile, `
[req] 
prompt = no 
default_bits = 4096
default_md = sha256
distinguished_name = dn 
x509_extensions = v3_req

[dn] 
C=CN
ST=ZheJiang
L=HangZhou
O=Alibaba
OU=AlimamaMux
CN=${CN}
emailAddress=yingchun.fyc@alibaba-inc.com

[v3_req]
keyUsage=keyEncipherment, dataEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
${hosts.map((item, index) => {
    return `DNS.${index + 1} = ${item}`
}).join('\n')}
IP.1 = 127.0.0.1
    `.trim())
}

/**
 * 通过命令行的交互方式收集配置信息，然后生成配置文件
 */
const createConfigFile = async (options) => {
  await fse.ensureDir(sslCertificateDir)
  createCnfFile(options)
}

/**
 * 创建密钥和自签名证书
 */
const createSSLKeyAndCrt = () => new Promise((resolve, reject) => {
  // 通过 .cnf 生成 .key、.crt
  exec(`openssl req \
    -new \
    -newkey rsa:2048 \
    -sha1 \
    -days 3650 \
    -nodes \
    -x509 \
    -keyout ${sslKeyPath} \
    -out ${sslCrtPath} \
    -config ${sslConfigFile}`, (error, stdout, stderr) => {
    if (error) {
      // console.log('*error*')
      // console.log(stderr)
      resolve({
        success: false
      })
      return
    }
    resolve({
      success: true,
      sslKeyPath,
      sslCrtPath
    })
  })
})

/**
 * OSX 在系统钥匙串里添加并始终信任自签名证书
 */
const trustSelfSignedCert = () => new Promise((resolve, reject) => {
  exec(`sudo security add-trusted-cert \
    -d -r trustRoot \
    -k /Library/Keychains/System.keychain \
    ${sslCrtPath}`, (error, stdout, stderr) => {
    if (error) {
      resolve(false)
      return
    }
    resolve(true)
  })
})

/**
 * 获取该工具添加到钥匙串里自签名证书列表，返回的是证书的sha-1列表
 */
const getKeyChainCertSha1List = () => {
  let sha1List
  if (isOSX) {
    try {
      const sha1Str = isOSX && execSync(`security find-certificate -a -c '${CN}' -Z | grep ^SHA-1`, { encoding: 'utf-8' })
      sha1List = sha1Str.replace(/SHA-1\shash:\s/g, '').split('\n').filter(sha1 => sha1)
    } catch (error) {
      // 找不到
      sha1List = []
    }
  } else {
    sha1List = []
  }
  return sha1List
}

/**
 * 卸载证书与删除信任
 */
const unInstall = async () => {
  const sha1List = getKeyChainCertSha1List()
  const existCrtDir = fs.existsSync(sslCertificateDir)
  if (!sha1List.length && !existCrtDir) {
    console.log('没有找到该工具安装的证书')
    // console.log('没有找到该工具创建的自签名证书，钥匙串里也没找到该工具添加的证书')
    return true
  }

  // const sha1 = execSync(`child.execSync('openssl x509 -sha1 -in ${sslCrtPath} -noout -fingerprint',{encoding: 'utf-8'}).split('=')[1].replace(/:/g, '').trim()`, {encoding: 'utf-8'})
  if (sha1List.length) {
    console.log(`正在删除钥匙串里名称是${CN}的证书`)
    try {
      sha1List.forEach(sha1 => {
        execSync(`sudo security delete-certificate -Z ${sha1}`)
      })
    } catch (error) {
      console.log('删除失败，流程结束')
      return false
    }
    console.log('删除成功')
  }
  if (existCrtDir) {
    execSync(`rm -rf ${sslCertificateDir}`)
    console.log(`已经删除存放密钥和证书的目录${sslCertificateDir}`)
  }
  console.log('删除完成')
  return true
}

/**
 * 创建自签名证书并信任
 */
const install = async () => {
  const sha1List = getKeyChainCertSha1List()
  const existCrtDir = fs.existsSync(sslCertificateDir)
  if (sha1List.length || existCrtDir) {
    let message
    if (sha1List.length && existCrtDir) {
      message = `继续操作会删除钥匙串里名称是${CN}的证书和存放密钥和自签名证书的目录${sslCertificateDir}`
    } else if (sha1List.length) {
      message = `继续操作会删除钥匙串里名称是${CN}的证书`
    } else if (existCrtDir) {
      message = `继续操作会删除存放密钥和自签名证书文件的目录${sslCertificateDir}`
    }
    message = '继续操作会覆盖该工具已创建的证书'
    const answer = await inquirer.prompt([{
      type: 'confirm',
      name: 'continue',
      message,
      default: false
    }])
    // 取消卸载或卸载失败
    if (!(answer.continue && await unInstall())) return
    if (!answer.continue) return
  }
  const options = await getInquirerAnswer()
  await createConfigFile(options)
  const result = await createSSLKeyAndCrt()
  if (result.success) {
    // console.log('generate ssl certificate successfully ^.^')
    console.log('成功创建密钥和自签名证书')
    // console.log('private key: ', sslKeyPath)
    // console.log('certificate: ', sslCrtPath)
  }

  // console.log('try add trust to system.keychain, need you permission')
  if (isOSX) {
    console.log('向系统的钥匙串里添加证书并始终信任...')
    const isTrustCert = await trustSelfSignedCert()
    if (isTrustCert) {
      console.log('添加并信任成功，钥匙串里名称为：', CN)
    } else {
      console.log('钥匙串添加证书失败')
    }
  }
  console.log('安装结束')
  console.log('')
  console.log('可随时通过下面命令行查看自签名信息')
  console.log('$ self-signed')
  console.log('')
  console.log('安装证书的结果：')
  currentState()
}

/**
 * 获取自签名证书里支持的域名
 */
const getCrtHosts = () => {
  let hosts
  try {
    hosts = execSync(`openssl x509 -in ${sslCrtPath} -noout -text | grep DNS`, { encoding: 'utf-8' }).trim().split(',').filter(item => item.includes('DNS:')).map(item => item.trim().replace(/DNS:/, ''))
  } catch (error) {
    // return false
    return []
  }
  return hosts
}

/**
 * 获取自己创建的证书密钥和自签名证书
 * @param {Array} param0
 */
const obtainSelfSigned = async (hosts = DEFAULTDOMAINS) => {
  const existSslKeyAndCrt = fs.existsSync(sslKeyPath) && fs.existsSync(sslCrtPath)
  let matched
  if (existSslKeyAndCrt) {
    const crtHosts = getCrtHosts()
    matched = hosts.every(host => {
      // m.tanx.com 能匹配上 *.tanx.com
      // (new RegExp('*.tanx.com'.replace('*','^[^.]+'))).test('m.tanx.com') // true
      return crtHosts.find(crtHostItem => {
        if (crtHostItem.includes('*')) {
          return (new RegExp(crtHostItem.replace('*', '^[^.]+'))).test(host)
        } else {
          return crtHostItem === host
        }
      })
    })
    if (!matched) {
      const addedHosts = hosts.filter(host => {
        return !crtHosts.find(crtHostItem => {
          if (crtHostItem.includes('*')) {
            return (new RegExp(crtHostItem.replace('*', '^[^.]+'))).test(host)
          } else {
            return crtHostItem === host
          }
        })
      })
      hosts = crtHosts.concat(addedHosts)
    }
  }
  if (existSslKeyAndCrt && matched) {
    const sha1List = getKeyChainCertSha1List()
    const sha1 = execSync(`openssl x509 -sha1 -in ${sslCrtPath} -noout -fingerprint`, { encoding: 'utf-8' }).split('=')[1].replace(/:/g, '').trim()
    let certTrusted
    if (sha1List.includes(sha1)) {
      certTrusted = true
    } else if (isOSX) {
      certTrusted = await trustSelfSignedCert()
    }
    return {
      success: true,
      sslKeyPath,
      sslCrtPath,
      certTrusted
    }
  } else if (existSslKeyAndCrt) {
    // console.log('已有的自签名证书里没有你需要的域名')
    // const answer = await inquirer.prompt([{
    //     type: 'confirm',
    //     name: 'continue',
    //     message: '是否更新自签名证书，新增要支持的域名',
    //     default: false
    // }])
    if (isOSX) {
      const sha1List = getKeyChainCertSha1List()
      // todo 要加sha-1比对才准确
      if (sha1List.length) {
        // console.log('自签名证书要新增支持的域名，正在更新自签名证书，需要重新信任')
        console.log('新增域名需要更新证书并重新信任')
      } else {
        console.log('新增域名需要更新证书')
        // console.log('自签名证书要新增支持的域名，正在更新自签名证书')
      }
      try {
        sha1List.forEach(sha1 => {
          execSync(`sudo security delete-certificate -Z ${sha1}`)
        })
      } catch (error) {
        return {
          success: false,
          message: '卸载老的证书失败，请授权重试'
          // sslKeyPath,
          // sslCrtPath,
        }
      }
    } else {
      console.log('自签名证书要新增支持的域名，正在更新自签名证书')
    }
    execSync(`rm -rf ${sslCertificateDir}`)
  }

  await createConfigFile({ hosts })

  const result = await createSSLKeyAndCrt()
  if (result.success) {
    let certTrusted = false
    if (isOSX) {
      certTrusted = await trustSelfSignedCert()
    }
    return {
      success: true,
      sslKeyPath,
      sslCrtPath,
      certTrusted
    }
  }
}

/**
 * 自签名信息
 */
const currentState = () => {
  const existSslKeyAndCrt = fs.existsSync(sslKeyPath) && fs.existsSync(sslCrtPath)
  if (!existSslKeyAndCrt) {
    console.log('还没有安装自签名证书，运行下面命令安装使用')
    console.log('$ self-signed install')
    return
  }
  console.log('创建的密钥文件路径是：', sslKeyPath)
  console.log('创建的自签名证书文件路径是：', sslCrtPath)
  console.log('证书的起止有效时间：')
  console.log(`${execSync(`openssl x509 -in ${sslCrtPath} -noout -dates`, { encoding: 'utf-8' })}`.trim())
  if (isOSX) {
    const sha1List = getKeyChainCertSha1List()
    const sha1 = execSync(`openssl x509 -sha1 -in ${sslCrtPath} -noout -fingerprint`, { encoding: 'utf-8' }).split('=')[1].replace(/:/g, '').trim()
    if (sha1List.includes(sha1)) {
      console.log(`自签名证书已经添加到钥匙串并被信任，名称是${CN}，sha-1是${sha1}`)
    } else {
      console.log('自签名证书还没被添加到钥匙串，可以运行下面命令，会自动添加到钥匙串并会始终信任')
      console.log('$ self-signed trust')
    }
  }
  console.log('自签名证书已经支持的域名：')
  const crtHosts = getCrtHosts()
  console.log(crtHosts.join(','))
  console.log('')
  console.log('更多使用帮助')
  console.log('$ self-signed --help')
  console.log('')
  console.log('如有疑问联系author@慧知')
}

/**
 * 信任自签名证书
 */
const trustSelfSigned = async () => {
  const existSslKeyAndCrt = fs.existsSync(sslKeyPath) && fs.existsSync(sslCrtPath)
  if (!existSslKeyAndCrt) {
    console.log('还没有安装自签名证书，运行下面命令安装使用')
    console.log('$ self-signed install')
    return
  }
  const sha1List = getKeyChainCertSha1List()
  const sha1 = execSync(`openssl x509 -sha1 -in ${sslCrtPath} -noout -fingerprint`, { encoding: 'utf-8' }).split('=')[1].replace(/:/g, '').trim()
  if (sha1List.includes(sha1)) {
    console.log(`证书已经添加过，无须重复添加，在钥匙串里的名称是${CN}，sha-1是${sha1}`)
  } else {
    const added = await trustSelfSignedCert()
    if (added) {
    //   console.log(`已成功添加自签名，名称是${CN}，sha-1是${sha1}`)
      console.log('添加并信任成功，钥匙串里名称为：', CN)
    } else {
      console.log('添加失败')
    }
  }
}

/**
 * 添加新的要支持的域名
 * @param {*} hosts
 */
const addHosts = async (hosts = []) => {
  if (!hosts.length) {
    console.log('输入要支持的host')
    return
  }
  const existSslKeyAndCrt = fs.existsSync(sslKeyPath) && fs.existsSync(sslCrtPath)
  if (!existSslKeyAndCrt) {
    console.log('还没有安装自签名证书，运行下面命令安装使用')
    console.log('$ self-signed install')
    return
  }

  const crtHosts = getCrtHosts()
  const matched = hosts.every(host => {
    return crtHosts.find(crtHostItem => {
      if (crtHostItem.includes('*')) {
        return (new RegExp(crtHostItem.replace('*', '^[^.]+'))).test(host)
      } else {
        return crtHostItem === host
      }
    })
  })
  if (matched) {
    console.log('证书已经支持该域名，无须添加了')
    return
  }
  if (!matched) {
    console.log(crtHosts)
    const addedHosts = hosts.filter(host => {
      return !crtHosts.find(crtHostItem => {
        if (crtHostItem.includes('*')) {
          return (new RegExp(crtHostItem.replace('*', '^[^.]+'))).test(host)
        } else {
          return crtHostItem === host
        }
      })
    })
    console.log(addedHosts)
    hosts = crtHosts.concat(addedHosts)
  }

  let sha1List
  if (isOSX) {
    sha1List = getKeyChainCertSha1List()
    // todo 要加sha-1比对才准确
    if (sha1List.length) {
      console.log('新增域名需要更新证书并重新信任')
    } else {
      console.log('正在更新证书')
    }
    try {
      sha1List.forEach(sha1 => {
        execSync(`sudo security delete-certificate -Z ${sha1}`)
      })
    } catch (error) {
      console.log('新增域名失败')
      return
    }
  } else {
    console.log('正在更新证书')
  }
  execSync(`rm -rf ${sslCertificateDir}`)

  await createConfigFile({ hosts })

  const result = await createSSLKeyAndCrt()
  if (result.success) {
    let certTrusted = false
    if (isOSX && sha1List.length) {
      certTrusted = trustSelfSignedCert()
    }
    console.log('更新成功')
    console.log('更新后支持的域名')
    const crtHosts = getCrtHosts()
    console.log(crtHosts.join(','))
    console.log('更新后证书的起止有效时间：')
    console.log(`${execSync(`openssl x509 -in ${sslCrtPath} -noout -dates`, { encoding: 'utf-8' })}`.trim())
  }
}

const removeSelfSigned = () => {

}

module.exports = {
  obtainSelfSigned,
  removeSelfSigned,
  currentState,
  install,
  unInstall,
  trustSelfSigned,
  addHosts
}
